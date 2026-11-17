import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmail } from '../../../application/models/code-email/rendered-email.model.js';
import type { InvitationEmailMessage } from '../../../application/models/invitation-email/invitation-email-message.model.js';
import type { CodeEmailTemplate } from '../../../domain/value-objects/code-email/code-email-template.value-object.js';
import { OneTimeCode } from '../../../domain/value-objects/code-email/one-time-code.value-object.js';
import { HandlebarsEmailRenderer } from './handlebars-email-renderer.adapter.js';

/**
 * Constant WEB_APP_URL
 *
 * @description
 * The web application of the local stack.
 *
 * @type {string}
 */
const WEB_APP_URL: string = 'http://app.cadenway.localhost';

/**
 * Function occurrences
 *
 * @description
 * Counts the occurrences of a text in another.
 *
 * @param {string} text - Where to look.
 * @param {string} searched - What to count.
 * @returns {number} How many times it appears.
 */
function occurrences(text: string, searched: string): number {
  return text.split(searched).length - 1;
}

/**
 * Function preheaderOf
 *
 * @description
 * Reads the preheader MJML writes as the first hidden block of the body.
 *
 * @param {string} html - The HTML part.
 * @returns {string} The preheader, whitespace collapsed.
 */
function preheaderOf(html: string): string {
  const match: RegExpExecArray | null = /overflow:hidden;">([\s\S]*?)<\/div>/u.exec(html);
  return (match?.[1] ?? '').replace(/\s+/gu, ' ').trim();
}

/**
 * Function visibleTextOf
 *
 * @description
 * The text a reader sees in the HTML part: tags, styles and the head removed, entities decoded,
 * whitespace collapsed.
 *
 * @param {string} html - The HTML part.
 * @returns {string} Its visible text.
 */
function visibleTextOf(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/u, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

describe('HandlebarsEmailRenderer', () => {
  let renderer: HandlebarsEmailRenderer;

  /**
   * Function render
   *
   * @description
   * Renders a template for Camille Martin, with the code of the mockup.
   *
   * @param {CodeEmailTemplate} template - The template.
   * @param {string} recipientName - The name to greet.
   * @returns {RenderedEmail} The e-mail.
   */
  function render(template: CodeEmailTemplate, recipientName = 'Camille Martin'): RenderedEmail {
    return renderer.renderCodeEmail({
      template,
      recipientName,
      code: OneTimeCode.of('482913'),
      validityMinutes: 10,
    });
  }

  beforeAll(async () => {
    renderer = await HandlebarsEmailRenderer.load(WEB_APP_URL);
  });

  describe.each<CodeEmailTemplate>(['email-verification', 'sign-in'])('%s', (template) => {
    it('shows the code once in each part, grouped as 482 913, and never as typed', () => {
      const email: RenderedEmail = render(template);

      expect(occurrences(email.html, '482 913')).toBe(1);
      expect(occurrences(email.text, '482 913')).toBe(1);
      expect(email.html).not.toContain('482913');
      expect(email.text).not.toContain('482913');
    });

    it('leaves no variable unrendered', () => {
      const email: RenderedEmail = render(template);

      for (const part of [email.subject, email.html, email.text]) {
        expect(part).not.toMatch(/\{\{|\}\}/u);
        expect(part).not.toContain('undefined');
      }
    });

    it('keeps the subject within 60 characters and the preheader within 90', () => {
      const email: RenderedEmail = render(template);

      expect(email.subject.length).toBeLessThanOrEqual(60);
      expect(preheaderOf(email.html).length).toBeGreaterThan(0);
      expect(preheaderOf(email.html).length).toBeLessThanOrEqual(90);
    });

    it('says the code is valid 10 minutes, once, and that a security e-mail cannot be turned off', () => {
      const email: RenderedEmail = render(template);

      for (const part of [visibleTextOf(email.html), email.text]) {
        expect(part).toContain('Valable 10 minutes, une seule fois');
        expect(part).toContain(
          'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
        );
        expect(part).toContain('Cadenway · 12 rue de la Charité, 69002 Lyon');
      }
    });

    it('mentions no workspace: an account has none at sign-up', () => {
      const email: RenderedEmail = render(template);

      for (const part of [email.subject, visibleTextOf(email.html), email.text]) {
        expect(part).not.toContain('espace de travail');
        expect(part).not.toContain('Atelier Nord');
      }
    });

    it('declares French as the language of the HTML part', () => {
      expect(render(template).html).toMatch(/<html lang="fr"/u);
    });
  });

  describe('Confirmation de l’adresse', () => {
    it('greets the new account and asks to confirm the address with the code', () => {
      const email: RenderedEmail = render('email-verification');
      const expected: readonly string[] = [
        'BIENVENUE SUR CADENWAY',
        'Bonjour Camille Martin, votre compte a été créé. Confirmez votre adresse avec ce code pour commencer à organiser vos tâches et vos espaces.',
        'Vous n’avez pas créé de compte ? Ignorez cet e-mail : rien ne sera activé.',
      ];

      expect(email.subject).toBe('Confirmez votre adresse pour activer votre compte');
      expect(preheaderOf(email.html)).toBe(
        'Un code pour finir votre inscription sur Cadenway, valable 10 minutes.',
      );
      expect(visibleTextOf(email.html)).toContain('Bienvenue sur Cadenway');
      for (const line of expected.slice(1)) {
        expect(visibleTextOf(email.html)).toContain(line);
      }
      for (const line of expected) {
        expect(email.text).toContain(line);
      }
    });

    it('writes the text part as the plain-text version of the mockup', () => {
      expect(render('email-verification').text).toBe(
        [
          'BIENVENUE SUR CADENWAY',
          '',
          'Bonjour Camille Martin, votre compte a été créé. Confirmez votre adresse avec ce code pour commencer à organiser vos tâches et vos espaces.',
          '',
          '    482 913',
          '    Valable 10 minutes, une seule fois',
          '',
          'Vous n’avez pas créé de compte ? Ignorez cet e-mail : rien ne sera activé.',
          '',
          '--',
          'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
          'Cadenway · 12 rue de la Charité, 69002 Lyon',
          '',
        ].join('\n'),
      );
    });

    it('greets without a name when none is left to show', () => {
      const email: RenderedEmail = render('email-verification', '');

      expect(email.text).toContain('Bonjour, votre compte a été créé.');
      expect(visibleTextOf(email.html)).toContain('Bonjour, votre compte a été créé.');
    });

    it('escapes the name in the HTML part', () => {
      const email: RenderedEmail = render('email-verification', 'Camille <b>Martin</b>');

      expect(email.html).toContain('Bonjour Camille &lt;b&gt;Martin&lt;/b&gt;,');
      expect(email.html).not.toContain('<b>Martin</b>');
    });
  });

  describe('Code de connexion', () => {
    it('shows the code in the subject, as the mockup does, and asks to type it on the sign-in page', () => {
      const email: RenderedEmail = render('sign-in');

      expect(email.subject).toBe('482 913 est votre code de connexion Cadenway');
      expect(preheaderOf(email.html)).toBe(
        'Code valable 10 minutes. Ne le communiquez à personne, même à l’assistance.',
      );
      for (const part of [visibleTextOf(email.html), email.text]) {
        expect(part).toContain(
          'Saisissez ce code sur la page de connexion pour accéder à Cadenway.',
        );
        expect(part).toContain(
          'Vous n’avez rien demandé ? Ignorez cet e-mail et ne communiquez ce code à personne, même à l’assistance.',
        );
      }
      expect(email.text).toContain('VOTRE CODE DE CONNEXION');
      expect(visibleTextOf(email.html)).toContain('Votre code de connexion');
    });

    it('links to the sign-in page of the web application', () => {
      const email: RenderedEmail = render('sign-in');

      expect(email.html).toContain(`href="${WEB_APP_URL}/login/code"`);
      expect(visibleTextOf(email.html)).toContain('Ouvrir la page de connexion');
      expect(email.text).toContain(`Ouvrir la page de connexion : ${WEB_APP_URL}/login/code`);
    });
  });

  describe('Invitation', () => {
    const invitationId: string = '01938f71-5d0b-7c3e-9a51-2f0c4b8d7e10';

    /**
     * Function invite
     *
     * @description
     * Renders the invitation of the mockup: Hugo Durand invites to join Atelier Nord (18 members)
     * as Membre, until 16 November 2026.
     *
     * @param {Partial<InvitationEmailMessage>} overrides - Fields to change.
     * @returns {RenderedEmail} The e-mail.
     */
    function invite(overrides: Partial<InvitationEmailMessage> = {}): RenderedEmail {
      return renderer.renderInvitationEmail({
        invitationId,
        inviterName: 'Hugo Durand',
        organizationName: 'Atelier Nord',
        memberCount: 18,
        role: 'member',
        expiresAt: new Date('2026-11-16T09:15:00.000Z'),
        ...overrides,
      });
    }

    it('writes the subject and the preheader of the mockup, within 60 and 90 characters', () => {
      const email: RenderedEmail = invite();

      expect(email.subject).toBe('Hugo Durand vous invite à rejoindre Atelier Nord');
      expect(email.subject.length).toBeLessThanOrEqual(60);
      expect(preheaderOf(email.html)).toBe(
        'Rôle proposé : Membre. L’invitation expire le 16 novembre 2026.',
      );
      expect(preheaderOf(email.html).length).toBeLessThanOrEqual(90);
    });

    it('writes the text part as the plain-text version of the mockup, without the personal message nor the space count', () => {
      expect(invite().text).toBe(
        [
          'Atelier Nord · 18 membres',
          '',
          'Hugo Durand vous invite à rejoindre l’organisation Atelier Nord sur Cadenway, avec le rôle Membre.',
          '',
          `Rejoindre Atelier Nord : ${WEB_APP_URL}/invite/${invitationId}`,
          '',
          'L’invitation expire le 16 novembre 2026. Vous ne connaissez pas Hugo ? Ignorez cet e-mail.',
          '',
          '--',
          'Vous recevez cet e-mail car un membre d’Atelier Nord a invité votre adresse.',
          'Cadenway · 12 rue de la Charité, 69002 Lyon',
          '',
        ].join('\n'),
      );
    });

    it('shows the header, the body, the button, the expiry note and the footer in the HTML part', () => {
      const email: RenderedEmail = invite();
      const visible: string = visibleTextOf(email.html);

      expect(visible).toContain('HD → AN Atelier Nord 18 membres');
      // The names and the role are bold, as in the mockup.
      expect(visible).toContain(
        'Hugo Durand vous invite à rejoindre l’organisation Atelier Nord sur Cadenway, avec le rôle Membre',
      );
      expect(email.html).toContain('<strong>Hugo Durand</strong>');
      expect(email.html).toContain('<strong>Membre</strong>.');
      expect(visible).toContain('Rejoindre Atelier Nord');
      expect(email.html).toContain(`href="${WEB_APP_URL}/invite/${invitationId}"`);
      expect(visible).toContain(
        'L’invitation expire le 16 novembre 2026. Vous ne connaissez pas Hugo ? Ignorez cet e-mail.',
      );
      expect(visible).toContain(
        'Vous recevez cet e-mail car un membre d’Atelier Nord a invité votre adresse.',
      );
      expect(visible).toContain('Cadenway · 12 rue de la Charité, 69002 Lyon');
      expect(visible).not.toContain('espaces');
      expect(visible).not.toContain('message personnel');
      expect(email.html).toMatch(/<html lang="fr"/u);
    });

    it.each<[InvitationEmailMessage['role'], string]>([
      ['admin', 'Administrateur'],
      ['member', 'Membre'],
      ['guest', 'Invité'],
    ])('proposes the role %s as "%s" in the preheader and the body', (role, label) => {
      const email: RenderedEmail = invite({ role });

      expect(preheaderOf(email.html)).toBe(
        `Rôle proposé : ${label}. L’invitation expire le 16 novembre 2026.`,
      );
      expect(email.text).toContain(`avec le rôle ${label}.`);
    });

    it('dates the expiry in Paris, the first of the month as "1er"', () => {
      const email: RenderedEmail = invite({ expiresAt: new Date('2026-11-30T23:30:00.000Z') });

      expect(email.text).toContain('L’invitation expire le 1er décembre 2026.');
      expect(preheaderOf(email.html)).toContain('expire le 1er décembre 2026.');
    });

    it('escapes the names of the inviter and of the organization in the HTML part only', () => {
      const email: RenderedEmail = invite({
        inviterName: 'Hugo <img src=x onerror=alert(1)>',
        organizationName: 'Atelier "Nord" & <b>Fils</b>',
      });

      expect(email.html).not.toContain('<img src=x');
      expect(email.html).not.toContain('<b>Fils</b>');
      expect(email.html).toContain('Hugo &lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
      expect(email.html).toContain('Atelier &quot;Nord&quot; &amp; &lt;b&gt;Fils&lt;/b&gt;');
      expect(email.subject).toBe(
        'Hugo <img src=x onerror=alert(1)> vous invite à rejoindre Atelier "Nord" & <b>Fils</b>',
      );
      expect(email.text).toContain('Rejoindre Atelier "Nord" & <b>Fils</b> : ');
    });

    it('elides the footer before a vowel only, and counts a lone member in the singular', () => {
      const email: RenderedEmail = invite({ organizationName: 'Studio Pivot', memberCount: 1 });

      expect(email.text).toContain('Studio Pivot · 1 membre\n');
      expect(email.text).toContain(
        'Vous recevez cet e-mail car un membre de Studio Pivot a invité votre adresse.',
      );
    });

    it('leaves no variable unrendered', () => {
      const email: RenderedEmail = invite();

      for (const part of [email.subject, email.html, email.text]) {
        expect(part).not.toMatch(/\{\{|\}\}/u);
        expect(part).not.toContain('undefined');
      }
    });
  });

  describe('loading', () => {
    let folder: string;

    beforeAll(async () => {
      folder = await mkdtemp(join(tmpdir(), 'cadenway-email-templates-'));
    });

    afterAll(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    it('refuses to start when the templates were not compiled', async () => {
      await expect(
        HandlebarsEmailRenderer.load(WEB_APP_URL, () =>
          createRequire(import.meta.url)(join(folder, 'missing.mjs')),
        ),
      ).rejects.toThrow(/not compiled/u);
    });

    it('refuses to start when a template is missing from the compiled module', async () => {
      const file: string = join(folder, 'partial.mjs');
      await writeFile(file, 'export const emailTemplates = { "sign-in": {} };\n', 'utf8');

      await expect(
        HandlebarsEmailRenderer.load(WEB_APP_URL, () => createRequire(import.meta.url)(file)),
      ).rejects.toThrow('The compiled e-mail templates lack the template "email-verification".');
    });
  });
});
