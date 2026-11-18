import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmail } from '../../../application/models/code-email/rendered-email.model.js';
import type { InvitationEmailMessage } from '../../../application/models/invitation-email/invitation-email-message.model.js';
import type { SecurityEmailClient } from '../../../application/models/security-email/security-email-client.model.js';
import type { SecurityEmailDetails } from '../../../application/models/security-email/security-email-details.model.js';
import type { SecurityEmailMessage } from '../../../application/models/security-email/security-email-message.model.js';
import type { CodeEmailTemplate } from '../../../domain/value-objects/code-email/code-email-template.value-object.js';
import { OneTimeCode } from '../../../domain/value-objects/code-email/one-time-code.value-object.js';
import { ResetLinkToken } from '../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import type { SecurityEmailTemplate } from '../../../domain/value-objects/security-email/security-email-template.value-object.js';
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

  describe.each<CodeEmailTemplate>(['email-verification', 'sign-in', 'email-change'])(
    '%s',
    (template) => {
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

      it('shows the frame of the security e-mails: "Sécurité · toujours envoyé"', () => {
        expect(visibleTextOf(render(template).html)).toContain(
          'Cadenway Sécurité · toujours envoyé',
        );
      });
    },
  );

  describe('Code de changement d’adresse', () => {
    it('asks to confirm the new address with a code valid 15 minutes', () => {
      const email: RenderedEmail = renderer.renderCodeEmail({
        template: 'email-change',
        recipientName: 'Camille Martin',
        code: OneTimeCode.of('208457'),
        validityMinutes: 15,
      });

      expect(email.subject).toBe('Confirmez votre nouvelle adresse e-mail');
      expect(preheaderOf(email.html)).toBe(
        'Code valable 15 minutes. Ne le communiquez à personne, même à l’assistance.',
      );
      expect(visibleTextOf(email.html)).toContain('Confirmez votre nouvelle adresse');
      expect(email.text).toBe(
        [
          'CONFIRMEZ VOTRE NOUVELLE ADRESSE',
          '',
          'Bonjour Camille Martin, saisissez ce code dans Cadenway pour faire de cette adresse celle de votre compte.',
          '',
          '    208 457',
          '    Valable 15 minutes, une seule fois',
          '',
          'Vous n’avez rien demandé ? Ignorez cet e-mail : l’adresse du compte ne changera pas. Ne communiquez ce code à personne, même à l’assistance.',
          '',
          '--',
          'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
          'Cadenway · 12 rue de la Charité, 69002 Lyon',
          '',
        ].join('\n'),
      );
    });

    it('greets without a name when none is left, and escapes the name in the HTML part', () => {
      const anonymous: RenderedEmail = render('email-change', '');
      const marked: RenderedEmail = render('email-change', 'Camille <i>M.</i>');

      expect(anonymous.text).toContain('Bonjour, saisissez ce code');
      expect(marked.html).toContain('Bonjour Camille &lt;i&gt;M.&lt;/i&gt;,');
      expect(marked.html).not.toContain('<i>M.</i>');
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

  describe('security e-mails', () => {
    /**
     * Constant TOKEN
     *
     * @description
     * The token of the example of `password-reset-link.issued.v1` in the contract.
     *
     * @type {string}
     */
    const TOKEN: string = 'ExampleOnlyResetToken0000000000000000000000';

    /**
     * Constant firefoxOnWindows
     *
     * @description
     * The browser of Camille Martin in the mockup.
     *
     * @type {SecurityEmailClient}
     */
    const firefoxOnWindows: SecurityEmailClient = {
      deviceType: 'desktop',
      browser: 'Firefox',
      os: 'Windows',
      osVersion: null,
      ipAddress: '192.0.2.14',
    };

    /**
     * Constant passwordChangedFromSession
     *
     * @description
     * A change of password from a session, which closes nothing.
     *
     * @type {SecurityEmailDetails}
     */
    const passwordChangedFromSession: SecurityEmailDetails = {
      template: 'password-changed',
      method: 'change',
      closedSessionCount: 0,
      client: firefoxOnWindows,
    };

    /**
     * Constant DETAILS
     *
     * @description
     * One message of each template, for Camille Martin, as the examples of the contract.
     *
     * @type {Readonly<Record<SecurityEmailTemplate, SecurityEmailDetails>>}
     */
    const DETAILS: Readonly<Record<SecurityEmailTemplate, SecurityEmailDetails>> = {
      'password-reset': {
        template: 'password-reset',
        token: ResetLinkToken.of(TOKEN),
        client: firefoxOnWindows,
      },
      'password-changed': {
        template: 'password-changed',
        method: 'reset',
        closedSessionCount: 3,
        client: firefoxOnWindows,
      },
      'email-changed': {
        template: 'email-changed',
        newEmail: 'camille@ateliernord.fr',
        client: firefoxOnWindows,
      },
      'new-device': {
        template: 'new-device',
        client: {
          deviceType: 'mobile',
          browser: 'Safari',
          os: 'iOS',
          osVersion: '18.1',
          ipAddress: '86.247.12.30',
        },
      },
      'deletion-scheduled': {
        template: 'deletion-scheduled',
        deleteAt: new Date('2026-12-09T15:30:00.000Z'),
      },
      'deletion-cancelled': { template: 'deletion-cancelled', client: firefoxOnWindows },
      'two-step-enabled': {
        template: 'two-step-enabled',
        backupCodesRemaining: 10,
        client: firefoxOnWindows,
      },
      'two-step-disabled': { template: 'two-step-disabled', client: firefoxOnWindows },
      'authenticator-app-replaced': {
        template: 'authenticator-app-replaced',
        client: firefoxOnWindows,
      },
      'backup-codes-regenerated': {
        template: 'backup-codes-regenerated',
        backupCodesRemaining: 10,
        client: firefoxOnWindows,
      },
      'security-key-added': {
        template: 'security-key-added',
        securityKeyName: 'YubiKey 5C NFC',
        client: firefoxOnWindows,
      },
      'security-key-removed': {
        template: 'security-key-removed',
        securityKeyName: 'YubiKey 5C NFC',
        client: firefoxOnWindows,
      },
    };

    /**
     * Constant FOOTER
     *
     * @description
     * The last lines of the text part of every security e-mail.
     *
     * @type {readonly string[]}
     */
    const FOOTER: readonly string[] = [
      '--',
      'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
      'Cadenway · 12 rue de la Charité, 69002 Lyon',
      '',
    ];

    /**
     * Constant TWO_STEP_TEMPLATES
     *
     * @description
     * The e-mails of the changes of the two-step verification.
     *
     * @type {readonly SecurityEmailTemplate[]}
     */
    const TWO_STEP_TEMPLATES: readonly SecurityEmailTemplate[] = [
      'two-step-enabled',
      'two-step-disabled',
      'authenticator-app-replaced',
      'backup-codes-regenerated',
      'security-key-added',
      'security-key-removed',
    ];

    /**
     * Function secure
     *
     * @description
     * Renders a security e-mail for Camille Martin, on 9 November 2026 at 14:10 in Paris, with a
     * window of 30 minutes.
     *
     * @param {SecurityEmailDetails} details - What the template shows.
     * @param {Partial<SecurityEmailMessage>} overrides - Fields of the message to change.
     * @returns {RenderedEmail} The e-mail.
     */
    function secure(
      details: SecurityEmailDetails,
      overrides: Partial<SecurityEmailMessage> = {},
    ): RenderedEmail {
      return renderer.renderSecurityEmail({
        recipientEmail: 'camille.martin@ateliernord.fr',
        occurredAt: new Date('2026-11-09T13:10:00.000Z'),
        validityMinutes: 30,
        timeZone: 'Europe/Paris',
        details,
        ...overrides,
      });
    }

    describe.each<SecurityEmailTemplate>([
      'password-reset',
      'password-changed',
      'email-changed',
      'new-device',
      'deletion-scheduled',
      'deletion-cancelled',
      ...TWO_STEP_TEMPLATES,
    ])('%s', (template) => {
      it('leaves no variable unrendered', () => {
        const email: RenderedEmail = secure(DETAILS[template]);

        for (const part of [email.subject, email.html, email.text]) {
          expect(part).not.toMatch(/\{\{|\}\}/u);
          expect(part).not.toContain('undefined');
          expect(part).not.toContain('null');
        }
      });

      it('keeps the subject within 60 characters and the preheader within 90', () => {
        const email: RenderedEmail = secure(DETAILS[template]);

        expect(email.subject.length).toBeLessThanOrEqual(60);
        expect(preheaderOf(email.html).length).toBeGreaterThan(0);
        expect(preheaderOf(email.html).length).toBeLessThanOrEqual(90);
      });

      it('shows the frame of the security e-mails, in French, with no unsubscription', () => {
        const email: RenderedEmail = secure(DETAILS[template]);

        expect(email.html).toMatch(/<html lang="fr"/u);
        expect(visibleTextOf(email.html)).toContain('Cadenway Sécurité · toujours envoyé');
        for (const part of [visibleTextOf(email.html), email.text]) {
          expect(part).toContain(
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
          );
          expect(part).toContain('Cadenway · 12 rue de la Charité, 69002 Lyon');
          expect(part).not.toContain('Gérer mes notifications');
          expect(part).not.toContain('Lieu (approximatif)');
        }
      });
    });

    describe('Réinitialisation du mot de passe', () => {
      const resetUrl: string = `${WEB_APP_URL}/reset#token=${TOKEN}`;

      it('writes the subject of the mockup and a link valid 30 minutes, not "1 heure"', () => {
        const email: RenderedEmail = secure(DETAILS['password-reset']);

        expect(email.subject).toBe('Réinitialisez votre mot de passe Cadenway');
        expect(preheaderOf(email.html)).toBe(
          'Lien valable 30 minutes. Ignorez cet e-mail si la demande ne vient pas de vous.',
        );
        for (const part of [email.subject, visibleTextOf(email.html), email.text]) {
          expect(part).not.toContain('1 heure');
        }
      });

      it('writes the text part as the plain-text version of the mockup, with the IP address instead of a place', () => {
        expect(secure(DETAILS['password-reset']).text).toBe(
          [
            'CHOISIR UN NOUVEAU MOT DE PASSE',
            '',
            'Une réinitialisation a été demandée pour camille.martin@ateliernord.fr. Choisissez un nouveau mot de passe avec le bouton ci-dessous.',
            '',
            `Choisir un nouveau mot de passe : ${resetUrl}`,
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            'Le lien expire dans 30 minutes. Votre mot de passe actuel reste valable tant que vous n’en choisissez pas un nouveau.',
            '',
            '--',
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
            'Cadenway · 12 rue de la Charité, 69002 Lyon',
            '',
          ].join('\n'),
        );
      });

      it('puts the token in the fragment of the link of the button and of the copyable link only', () => {
        const email: RenderedEmail = secure(DETAILS['password-reset']);
        const visible: string = visibleTextOf(email.html);

        // Handlebars escapes `=` in the HTML part; a browser reads `&#x3D;` back as `=`.
        expect(email.html).toContain(`href="${WEB_APP_URL}/reset#token&#x3D;${TOKEN}"`);
        expect(occurrences(email.html, TOKEN)).toBe(2);
        expect(occurrences(email.text, TOKEN)).toBe(1);
        expect(email.subject).not.toContain(TOKEN);
        expect(preheaderOf(email.html)).not.toContain(TOKEN);
        expect(email.html).toContain('<strong>camille.martin@ateliernord.fr</strong>');
        expect(visible).toContain(
          'Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :',
        );
        expect(visible).toContain(
          'Appareil Firefox sur Windows Adresse IP 192.0.2.14 Date 9 novembre 2026 à 14:10 (heure de Paris)',
        );
      });
    });

    describe('Mot de passe modifié', () => {
      it('says the reset closed the 3 other sessions, as the event counts them', () => {
        const email: RenderedEmail = secure(DETAILS['password-changed']);

        expect(email.subject).toBe('Votre mot de passe a été modifié');
        expect(preheaderOf(email.html)).toBe(
          'Si ce n’était pas vous, sécurisez votre compte maintenant.',
        );
        expect(email.html).toContain('<strong>vos 3 autres sessions ont été fermées</strong>');
        expect(email.html).toContain(`href="${WEB_APP_URL}/forgot"`);
        expect(email.text).toBe(
          [
            'MOT DE PASSE MODIFIÉ',
            '',
            'Le mot de passe de votre compte vient d’être modifié. Par sécurité, vos 3 autres sessions ont été fermées.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Réinitialisez votre mot de passe tout de suite, puis prévenez l’administrateur de votre organisation.',
            '',
            `Sécuriser mon compte : ${WEB_APP_URL}/forgot`,
            '',
            '--',
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
            'Cadenway · 12 rue de la Charité, 69002 Lyon',
            '',
          ].join('\n'),
        );
      });

      it.each<[string, SecurityEmailDetails, string]>([
        [
          'a reset that closed 5 sessions',
          { ...passwordChangedFromSession, method: 'reset', closedSessionCount: 5 },
          'Par sécurité, vos 5 autres sessions ont été fermées.',
        ],
        [
          'a reset that closed 1 session',
          { ...passwordChangedFromSession, method: 'reset', closedSessionCount: 1 },
          'Par sécurité, votre autre session a été fermée.',
        ],
        [
          'a reset that kept the other sessions',
          { ...passwordChangedFromSession, method: 'reset', closedSessionCount: 0 },
          'modifié. Vos autres sessions restent ouvertes.',
        ],
        [
          'a change from a session',
          passwordChangedFromSession,
          'modifié. Vos autres sessions restent ouvertes.',
        ],
      ])('states what happened to the sessions after %s', (_case, details, sentence) => {
        const email: RenderedEmail = secure(details);

        expect(email.text).toContain(sentence);
        expect(visibleTextOf(email.html)).not.toContain('vos 3 autres sessions');
      });
    });

    describe('Adresse e-mail modifiée', () => {
      it('tells the previous address which one replaced it, with no link to revert the change', () => {
        const email: RenderedEmail = secure(DETAILS['email-changed']);

        expect(email.subject).toBe('L’adresse e-mail de votre compte a été modifiée');
        expect(preheaderOf(email.html)).toBe(
          'Vos e-mails partent désormais vers une autre adresse. Ce n’était pas vous ? Agissez vite.',
        );
        expect(email.html).toContain('<strong>camille@ateliernord.fr</strong>');
        expect(email.text).toBe(
          [
            'ADRESSE E-MAIL MODIFIÉE',
            '',
            'L’adresse e-mail de votre compte a été remplacée par camille@ateliernord.fr : elle est vérifiée et reçoit désormais vos e-mails. Cette adresse-ci n’en recevra plus.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, vérifiez vos sessions et changez votre mot de passe, puis prévenez l’administrateur de votre organisation.',
            '',
            `Vérifier mes sessions : ${WEB_APP_URL}/account/security`,
            '',
            '--',
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
            'Cadenway · 12 rue de la Charité, 69002 Lyon',
            '',
          ].join('\n'),
        );
        expect([...email.html.matchAll(/href="([^"]+)"/gu)].map((match) => match[1])).toEqual([
          `${WEB_APP_URL}/account/security`,
        ]);
      });
    });

    describe('Nouvelle connexion', () => {
      it('names the browser in the subject and shows the IP address instead of a place', () => {
        const email: RenderedEmail = secure(DETAILS['new-device'], {
          occurredAt: new Date('2026-11-09T07:42:00.000Z'),
        });

        expect(email.subject).toBe('Nouvelle connexion depuis Safari sur iOS');
        expect(preheaderOf(email.html)).toBe(
          '86.247.12.30 · 9 novembre à 08:42. Vérifiez vos sessions si ce n’était pas vous.',
        );
        expect(email.html).toContain(`href="${WEB_APP_URL}/account/security"`);
        expect(email.text).toBe(
          [
            'NOUVELLE CONNEXION DÉTECTÉE',
            '',
            'Votre compte vient d’être utilisé sur un appareil que nous ne connaissions pas.',
            '',
            'Appareil : Safari sur iOS 18.1',
            'Adresse IP : 86.247.12.30',
            'Date : 9 novembre 2026 à 08:42 (heure de Paris)',
            '',
            'Si c’était vous, vous n’avez rien à faire. Sinon, fermez cette session et changez votre mot de passe.',
            '',
            `Vérifier mes sessions : ${WEB_APP_URL}/account/security`,
            '',
            '--',
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
            'Cadenway · 12 rue de la Charité, 69002 Lyon',
            '',
          ].join('\n'),
        );
      });

      it.each<[string, Partial<SecurityEmailClient>]>([
        ['the browser', { browser: null }],
        ['the operating system', { os: null }],
        ['both', { browser: null, os: null }],
      ])('falls back on a subject without device when %s is unknown', (_part, unknown) => {
        const email: RenderedEmail = secure({
          template: 'new-device',
          client: { ...firefoxOnWindows, ...unknown },
        });

        expect(email.subject).toBe('Nouvelle connexion à votre compte Cadenway');
        expect(email.text).not.toContain('null');
      });
    });

    describe('Suppression du compte', () => {
      it('dates the deletion from deleteAt and counts its delay', () => {
        const email: RenderedEmail = secure(DETAILS['deletion-scheduled'], {
          occurredAt: new Date('2026-11-09T15:30:00.000Z'),
        });

        expect(email.subject).toBe('La suppression de votre compte est programmée');
        expect(preheaderOf(email.html)).toBe(
          'Votre compte sera supprimé le 9 décembre 2026. Vous pouvez encore annuler.',
        );
        expect(visibleTextOf(email.html)).toContain('Suppression programmée le 9 décembre');
        expect(email.html).toContain('<strong>30 jours</strong>');
        expect(email.html).toContain(`href="${WEB_APP_URL}/account"`);
        expect(email.text).toBe(
          [
            'SUPPRESSION PROGRAMMÉE LE 9 DÉCEMBRE',
            '',
            'Comme demandé, votre compte et vos données personnelles seront supprimés définitivement dans 30 jours. Jusque-là, une connexion suffit pour annuler.',
            '',
            'Supprimé : Profil, préférences, jetons d’API, sessions',
            'Conservé : Tâches et documents de l’organisation, attribués à « Ancien membre »',
            '',
            `Annuler la suppression : ${WEB_APP_URL}/account`,
            '',
            '--',
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
            'Cadenway · 12 rue de la Charité, 69002 Lyon',
            '',
          ].join('\n'),
        );
      });

      it('takes the day of the deletion in the time zone of the account, Paris when unknown', () => {
        const late: SecurityEmailDetails = {
          template: 'deletion-scheduled',
          deleteAt: new Date('2026-12-09T23:30:00.000Z'),
        };

        expect(preheaderOf(secure(late, { timeZone: 'America/New_York' }).html)).toContain(
          'le 9 décembre 2026.',
        );
        expect(preheaderOf(secure(late, { timeZone: 'Mars/Olympus' }).html)).toContain(
          'le 10 décembre 2026.',
        );
      });
    });

    describe('Suppression annulée', () => {
      it('tells that a sign-in cancelled the deletion, and what to do if it was not the person', () => {
        const email: RenderedEmail = secure(DETAILS['deletion-cancelled'], {
          occurredAt: new Date('2026-11-10T08:05:00.000Z'),
        });

        expect(email.subject).toBe('La suppression de votre compte est annulée');
        expect(preheaderOf(email.html)).toBe(
          'Une connexion vient d’annuler la suppression de votre compte, qui reste actif.',
        );
        expect(email.text).toBe(
          [
            'SUPPRESSION ANNULÉE',
            '',
            'Une connexion à votre compte vient d’annuler sa suppression programmée : votre compte reste actif, avec vos données.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 10 novembre 2026 à 09:05 (heure de Paris)',
            '',
            'Vous souhaitez toujours supprimer votre compte ? Programmez de nouveau la suppression depuis votre profil.',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un connaît peut-être votre mot de passe : changez-le depuis votre profil, puis vérifiez vos sessions.',
            '',
            `Vérifier mes sessions : ${WEB_APP_URL}/account/security`,
            '',
            '--',
            'E-mail de sécurité lié à votre compte : il ne peut pas être désactivé.',
            'Cadenway · 12 rue de la Charité, 69002 Lyon',
            '',
          ].join('\n'),
        );
      });
    });

    describe('Vérification en deux étapes activée', () => {
      it('writes the e-mail of the mockup with "codes de secours", the device and a link that does not promise the codes', () => {
        const email: RenderedEmail = secure(DETAILS['two-step-enabled'], {
          occurredAt: new Date('2026-11-09T13:21:00.000Z'),
        });

        expect(email.subject).toBe('La vérification en deux étapes est activée');
        expect(preheaderOf(email.html)).toBe(
          'Gardez vos codes de secours en lieu sûr : ils remplacent votre téléphone.',
        );
        expect(email.text).toBe(
          [
            'VÉRIFICATION EN DEUX ÉTAPES ACTIVÉE',
            '',
            'À chaque connexion, Cadenway vous demandera un code de votre application d’authentification, en plus de votre mot de passe.',
            '',
            'Méthode : Application d’authentification',
            'Codes de secours : 10 codes générés',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Activée le : 9 novembre 2026 à 14:21 (heure de Paris)',
            '',
            'Vos codes de secours sont le seul moyen d’accéder au compte si vous perdez votre téléphone. Imprimez-les ou rangez-les dans un gestionnaire de mots de passe : Cadenway ne les affichera plus.',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, vérifiez vos sessions et changez votre mot de passe, puis prévenez l’administrateur de votre organisation.',
            '',
            `Gérer la vérification en deux étapes : ${WEB_APP_URL}/account/security`,
            '',
            ...FOOTER,
          ].join('\n'),
        );
        const visible: string = visibleTextOf(email.html);
        expect(visible).toContain('Vérification en deux étapes activée');
        expect(visible).toContain('Codes de secours 10 codes générés');
        expect(visible).toContain('Activée le 9 novembre 2026 à 14:21 (heure de Paris)');
        expect(visible).toContain('Gérer la vérification en deux étapes');
        expect(visible).not.toContain('récupération');
        expect(visible).not.toContain('Voir mes codes');
      });
    });

    describe('Vérification en deux étapes désactivée', () => {
      it('says what was deleted and what to do if it was not the person', () => {
        const email: RenderedEmail = secure(DETAILS['two-step-disabled']);

        expect(email.subject).toBe('La vérification en deux étapes est désactivée');
        expect(preheaderOf(email.html)).toBe(
          'Votre compte n’est protégé que par un mot de passe. Ce n’était pas vous ? Agissez vite.',
        );
        expect(email.text).toBe(
          [
            'VÉRIFICATION EN DEUX ÉTAPES DÉSACTIVÉE',
            '',
            'La vérification en deux étapes de votre compte vient d’être désactivée : votre application d’authentification, vos clés de sécurité et vos codes de secours ont été supprimés, et vos appareils de confiance oubliés. Votre compte n’est protégé que par un mot de passe.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, changez votre mot de passe, réactivez la vérification en deux étapes et vérifiez vos sessions, puis prévenez l’administrateur de votre organisation.',
            '',
            `Gérer la vérification en deux étapes : ${WEB_APP_URL}/account/security`,
            '',
            ...FOOTER,
          ].join('\n'),
        );
      });
    });

    describe('Application d’authentification remplacée', () => {
      it('says the codes of the previous app no longer work and the backup codes still do', () => {
        const email: RenderedEmail = secure(DETAILS['authenticator-app-replaced']);

        expect(email.subject).toBe('Votre application d’authentification a été remplacée');
        expect(preheaderOf(email.html)).toBe(
          'Seule la nouvelle application est acceptée. Ce n’était pas vous ? Agissez vite.',
        );
        expect(email.text).toBe(
          [
            'APPLICATION D’AUTHENTIFICATION REMPLACÉE',
            '',
            'Une nouvelle application d’authentification vient d’être configurée pour votre compte : les codes de l’ancienne ne sont plus acceptés. Vos codes de secours restent valables.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, changez votre mot de passe, reconfigurez votre application et vérifiez vos sessions, puis prévenez l’administrateur de votre organisation.',
            '',
            `Gérer la vérification en deux étapes : ${WEB_APP_URL}/account/security`,
            '',
            ...FOOTER,
          ].join('\n'),
        );
      });
    });

    describe('Nouveaux codes de secours', () => {
      it('counts the backup codes left, as Compte › Sécurité et connexion does', () => {
        const email: RenderedEmail = secure(DETAILS['backup-codes-regenerated']);

        expect(email.subject).toBe('Vos codes de secours ont été renouvelés');
        expect(preheaderOf(email.html)).toBe(
          'Les codes précédents ne fonctionnent plus. Ce n’était pas vous ? Agissez vite.',
        );
        expect(email.text).toBe(
          [
            'NOUVEAUX CODES DE SECOURS',
            '',
            'De nouveaux codes de secours viennent d’être générés pour votre compte : les codes précédents ne fonctionnent plus.',
            '',
            'Codes de secours : 10 codes inutilisés sur 10',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            'Conservez ces codes de secours hors ligne, imprimés ou dans un gestionnaire de mots de passe : chacun ne sert qu’une fois, et Cadenway ne les affichera plus.',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, générez de nouveaux codes, changez votre mot de passe et vérifiez vos sessions, puis prévenez l’administrateur de votre organisation.',
            '',
            `Gérer la vérification en deux étapes : ${WEB_APP_URL}/account/security`,
            '',
            ...FOOTER,
          ].join('\n'),
        );
        expect(visibleTextOf(email.html)).toContain('Codes de secours 10 codes inutilisés sur 10');
      });

      it('counts a lone code in the singular', () => {
        const email: RenderedEmail = secure({
          template: 'backup-codes-regenerated',
          backupCodesRemaining: 1,
          client: firefoxOnWindows,
        });

        expect(email.text).toContain('Codes de secours : 1 code inutilisé sur 10');
      });
    });

    describe('Clé de sécurité ajoutée', () => {
      it('names the key that was added and what to do if it was not the person', () => {
        const email: RenderedEmail = secure(DETAILS['security-key-added']);

        expect(email.subject).toBe('Une clé de sécurité a été ajoutée à votre compte');
        expect(preheaderOf(email.html)).toBe(
          'Elle pourra servir dès la prochaine connexion. Ce n’était pas vous ? Agissez vite.',
        );
        expect(email.html).toContain('<strong>YubiKey 5C NFC</strong>');
        expect(email.text).toBe(
          [
            'CLÉ DE SÉCURITÉ AJOUTÉE',
            '',
            'La clé de sécurité YubiKey 5C NFC vient d’être ajoutée à votre compte : elle pourra servir dès la prochaine connexion.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, retirez cette clé, changez votre mot de passe et vérifiez vos sessions, puis prévenez l’administrateur de votre organisation.',
            '',
            `Gérer la vérification en deux étapes : ${WEB_APP_URL}/account/security`,
            '',
            ...FOOTER,
          ].join('\n'),
        );
      });
    });

    describe('Clé de sécurité retirée', () => {
      it('names the key that was removed and what to do if it was not the person', () => {
        const email: RenderedEmail = secure(DETAILS['security-key-removed']);

        expect(email.subject).toBe('Une clé de sécurité a été retirée de votre compte');
        expect(preheaderOf(email.html)).toBe(
          'Elle ne servira plus à vous connecter. Ce n’était pas vous ? Agissez vite.',
        );
        expect(email.text).toBe(
          [
            'CLÉ DE SÉCURITÉ RETIRÉE',
            '',
            'La clé de sécurité YubiKey 5C NFC vient d’être retirée de votre compte : elle ne servira plus à vous connecter.',
            '',
            'Appareil : Firefox sur Windows',
            'Adresse IP : 192.0.2.14',
            'Date : 9 novembre 2026 à 14:10 (heure de Paris)',
            '',
            '---',
            '',
            'Ce n’était pas vous ? Quelqu’un a peut-être accès à votre compte. Si vous êtes encore connecté, changez votre mot de passe et vérifiez vos sessions, puis prévenez l’administrateur de votre organisation.',
            '',
            `Gérer la vérification en deux étapes : ${WEB_APP_URL}/account/security`,
            '',
            ...FOOTER,
          ].join('\n'),
        );
      });
    });

    describe.each<'security-key-added' | 'security-key-removed'>([
      'security-key-added',
      'security-key-removed',
    ])('%s', (template) => {
      it('escapes the name of the key in the HTML part only, and keeps it out of the subject', () => {
        const email: RenderedEmail = secure({
          template,
          securityKeyName: '<img src=x onerror=alert(1)> & "Co"',
          client: firefoxOnWindows,
        });

        expect(email.html).not.toContain('<img src=x');
        expect(email.html).toContain(
          '<strong>&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt; &amp; &quot;Co&quot;</strong>',
        );
        expect(email.text).toContain(
          'La clé de sécurité <img src=x onerror=alert(1)> & "Co" vient',
        );
        expect(email.subject).not.toContain('img');
      });

      it('names no key when the event held no showable name', () => {
        const email: RenderedEmail = secure({
          template,
          securityKeyName: null,
          client: firefoxOnWindows,
        });

        expect(email.text).toMatch(
          /\n\nUne clé de sécurité vient d’être (ajoutée à|retirée de) votre compte/u,
        );
        expect(email.html).not.toContain('<strong></strong>');
        expect(visibleTextOf(email.html)).toMatch(
          /Une clé de sécurité vient d’être (ajoutée à|retirée de) votre compte/u,
        );
      });
    });

    it.each(TWO_STEP_TEMPLATES)(
      'links %s to the two-step verification of the account, and nowhere else',
      (template) => {
        const email: RenderedEmail = secure(DETAILS[template]);

        expect([...email.html.matchAll(/href="([^"]+)"/gu)].map((match) => match[1])).toEqual([
          `${WEB_APP_URL}/account/security`,
        ]);
      },
    );

    it.each(TWO_STEP_TEMPLATES)(
      'dates %s in the time zone of the account, and in Paris when the zone is unknown',
      (template) => {
        const label: string = template === 'two-step-enabled' ? 'Activée le' : 'Date';

        expect(secure(DETAILS[template], { timeZone: 'America/New_York' }).text).toContain(
          `${label} : 9 novembre 2026 à 08:10 (UTC−5)`,
        );
        expect(secure(DETAILS[template], { timeZone: 'Mars/Olympus' }).text).toContain(
          `${label} : 9 novembre 2026 à 14:10 (heure de Paris)`,
        );
      },
    );

    it('dates the rows in the time zone of the account, and in Paris when the zone is unknown', () => {
      const newYork: RenderedEmail = secure(DETAILS['deletion-cancelled'], {
        timeZone: 'America/New_York',
      });
      const unknown: RenderedEmail = secure(DETAILS['deletion-cancelled'], {
        timeZone: 'Mars/Olympus',
      });

      expect(newYork.text).toContain('Date : 9 novembre 2026 à 08:10 (UTC−5)');
      expect(unknown.text).toContain('Date : 9 novembre 2026 à 14:10 (heure de Paris)');
    });

    it('escapes the device and the IP address in the HTML part only', () => {
      const email: RenderedEmail = secure({
        template: 'new-device',
        client: {
          deviceType: 'desktop',
          browser: '<img src=x onerror=alert(1)>',
          os: 'Linux & "Co"',
          osVersion: null,
          ipAddress: '<b>192.0.2.14</b>',
        },
      });

      expect(email.html).not.toContain('<img src=x');
      expect(email.html).not.toContain('<b>192.0.2.14</b>');
      expect(email.html).toContain(
        '&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt; sur Linux &amp; &quot;Co&quot;',
      );
      expect(email.html).toContain('&lt;b&gt;192.0.2.14&lt;/b&gt;');
      expect(email.subject).toBe(
        'Nouvelle connexion depuis <img src=x onerror=alert(1)> sur Linux & "Co"',
      );
      expect(email.text).toContain('Adresse IP : <b>192.0.2.14</b>');
    });

    it('escapes the new address in the HTML part', () => {
      const email: RenderedEmail = secure({
        template: 'email-changed',
        newEmail: '"<b>camille</b>"@ateliernord.fr',
        client: firefoxOnWindows,
      });

      expect(email.html).not.toContain('<b>camille</b>');
      expect(email.html).toContain('&quot;&lt;b&gt;camille&lt;/b&gt;&quot;@ateliernord.fr');
    });

    it('says the address is unknown when the event held no showable one', () => {
      const email: RenderedEmail = secure(
        { template: 'new-device', client: { ...firefoxOnWindows, ipAddress: null } },
        { occurredAt: new Date('2026-11-09T07:42:00.000Z') },
      );

      expect(email.text).toContain('Adresse IP : Adresse inconnue');
      expect(preheaderOf(email.html)).toBe(
        'Adresse inconnue · 9 novembre à 08:42. Vérifiez vos sessions si ce n’était pas vous.',
      );
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
