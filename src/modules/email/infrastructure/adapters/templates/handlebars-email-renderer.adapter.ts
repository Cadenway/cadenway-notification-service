import { createRequire } from 'node:module';
import type { CodeEmailMessage } from '../../../application/models/code-email/code-email-message.model.js';
import type { EmailRenderer } from '../../../application/ports/outbound/templates/code-email/email-renderer.port.js';
import type { RenderedEmail } from '../../../application/models/code-email/rendered-email.model.js';
import type { InvitationEmailMessage } from '../../../application/models/invitation-email/invitation-email-message.model.js';
import type { InvitationEmailRenderer } from '../../../application/ports/outbound/templates/invitation-email/invitation-email-renderer.port.js';
import type { SecurityEmailMessage } from '../../../application/models/security-email/security-email-message.model.js';
import type { SecurityEmailRenderer } from '../../../application/ports/outbound/templates/security-email/security-email-renderer.port.js';
import type { CodeEmailTemplate } from '../../../domain/value-objects/code-email/code-email-template.value-object.js';
import type { SecurityEmailTemplate } from '../../../domain/value-objects/security-email/security-email-template.value-object.js';
import { invitationEmailContext } from './invitation-email-wording.js';
import { securityEmailContext } from './security-email-wording.js';

/**
 * Type CompiledTemplate
 *
 * @description
 * A template precompiled by `scripts/build-email-templates.mjs` and turned into a function by the
 * Handlebars runtime. Strict: a value missing from the context throws.
 *
 * @type {(context: Readonly<Record<string, unknown>>) => string}
 */
type CompiledTemplate = (context: Readonly<Record<string, unknown>>) => string;

/**
 * Interface HandlebarsRuntime
 *
 * @description
 * The part of `handlebars/runtime` this adapter uses. The runtime ships without usable type
 * declarations (its `runtime.d.ts` exports nothing), hence this local description.
 */
interface HandlebarsRuntime {
  // #region Methods
  /**
   * Method create
   *
   * @description
   * An isolated environment, so no helper or partial registered elsewhere reaches the e-mails.
   *
   * @returns {HandlebarsRuntime} A new environment.
   */
  create(): HandlebarsRuntime;

  /**
   * Method template
   *
   * @description
   * Turns a precompiled specification into a template function. Throws when the specification was
   * precompiled by another major version of Handlebars.
   *
   * @param {unknown} specification - The precompiled specification.
   * @returns {CompiledTemplate} The template function.
   */
  template(specification: unknown): CompiledTemplate;
  // #endregion
}

/**
 * Interface CompiledEmail
 *
 * @description
 * The three precompiled parts of one template.
 */
interface CompiledEmail {
  // #region Properties
  /**
   * Property subject
   *
   * @description
   * Subject, plain text.
   *
   * @type {CompiledTemplate}
   * @readonly
   */
  readonly subject: CompiledTemplate;

  /**
   * Property html
   *
   * @description
   * HTML part compiled from MJML, values HTML-escaped.
   *
   * @type {CompiledTemplate}
   * @readonly
   */
  readonly html: CompiledTemplate;

  /**
   * Property text
   *
   * @description
   * Plain-text part.
   *
   * @type {CompiledTemplate}
   * @readonly
   */
  readonly text: CompiledTemplate;
  // #endregion
}

/**
 * Type TemplateName
 *
 * @description
 * The name of a template folder: the code e-mails, the invitation e-mail and the security e-mails.
 *
 * @type {CodeEmailTemplate | 'invitation' | SecurityEmailTemplate}
 */
type TemplateName = CodeEmailTemplate | 'invitation' | SecurityEmailTemplate;

/**
 * Constant TEMPLATES
 *
 * @description
 * The templates the service needs; the start-up fails when the generated module lacks one.
 *
 * @type {readonly TemplateName[]}
 */
const TEMPLATES: readonly TemplateName[] = [
  'email-verification',
  'sign-in',
  'email-change',
  'invitation',
  'password-reset',
  'password-changed',
  'email-changed',
  'new-device',
  'deletion-scheduled',
  'deletion-cancelled',
  'two-step-enabled',
  'two-step-disabled',
  'authenticator-app-replaced',
  'backup-codes-regenerated',
  'security-key-added',
  'security-key-removed',
];

/**
 * Constant PARTS
 *
 * @description
 * The precompiled parts of every template.
 *
 * @type {readonly (keyof CompiledEmail)[]}
 */
const PARTS: readonly (keyof CompiledEmail)[] = ['subject', 'html', 'text'];

/**
 * Function loadGeneratedTemplates
 *
 * @description
 * Loads the precompiled templates copied next to this adapter by the Nest compiler.
 *
 * @returns {unknown} The module to validate before creating template functions.
 */
function loadGeneratedTemplates(): unknown {
  return createRequire(import.meta.url)('./generated/email-templates.js');
}

/**
 * Function isRecord
 *
 * @description
 * Whether a loaded value is a plain object, to read the generated module without trusting it.
 *
 * @param {unknown} value - The value.
 * @returns {boolean} Whether it is a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Class HandlebarsEmailRenderer
 *
 * @description
 * Renders the e-mails with the templates compiled at build time (cw-email-templates): MJML was
 * compiled to HTML and every part precompiled by Handlebars, so only `handlebars/runtime` runs
 * here. Templates are strict: a value missing from the context throws instead of leaving a gap in
 * the e-mail. The HTML part escapes the values it receives, such as the name of the recipient; the
 * subject and the text part are plain text.
 *
 * The French copy is the one of the Emails artboard of the mockup, adapted to a 6-digit code for
 * the code e-mails; the e-mails the artboard lacks (the address-change code, the notice to the
 * previous address, the cancelled deletion, the changes of the two-step verification but its
 * activation) are new copy in its style. Every recipient gets it, whatever the `language` of the
 * event: the mockup has no other language yet.
 */
export class HandlebarsEmailRenderer
  implements EmailRenderer, InvitationEmailRenderer, SecurityEmailRenderer
{
  // #region Properties
  /**
   * Property templates
   *
   * @description
   * The compiled templates, by name.
   *
   * @type {ReadonlyMap<TemplateName, CompiledEmail>}
   * @readonly
   */
  private readonly templates: ReadonlyMap<TemplateName, CompiledEmail>;

  /**
   * Property webAppUrl
   *
   * @description
   * Origin of the web application, for the links of the templates.
   *
   * @type {string}
   * @readonly
   */
  private readonly webAppUrl: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps templates already loaded by `load`.
   *
   * @param {ReadonlyMap<TemplateName, CompiledEmail>} templates - The compiled templates.
   * @param {string} webAppUrl - Origin of the web application, without a trailing slash.
   * @constructor
   */
  private constructor(templates: ReadonlyMap<TemplateName, CompiledEmail>, webAppUrl: string) {
    this.templates = templates;
    this.webAppUrl = webAppUrl;
  }
  // #endregion

  // #region Methods
  /**
   * Method load
   *
   * @description
   * Loads the generated module and turns each part into a template function, once, at start-up.
   *
   * @param {string} webAppUrl - Origin of the web application, without a trailing slash.
   * @param {() => unknown} loadTemplates - Loads the generated module. Tests can supply a loader.
   * @returns {Promise<HandlebarsEmailRenderer>} The renderer.
   * @throws {Error} When the module is missing (the templates were not compiled: run
   * `pnpm build`), or lacks a template or a part.
   */
  public static async load(
    webAppUrl: string,
    loadTemplates: () => unknown = loadGeneratedTemplates,
  ): Promise<HandlebarsEmailRenderer> {
    const runtime: HandlebarsRuntime = (
      createRequire(import.meta.url)('handlebars/runtime') as HandlebarsRuntime
    ).create();
    let loaded: unknown;
    try {
      loaded = await loadTemplates();
    } catch (error) {
      throw new Error(
        'The e-mail templates are not compiled: run `pnpm build` (or node scripts/build-email-templates.mjs).',
        { cause: error },
      );
    }
    const specifications: unknown = isRecord(loaded) ? loaded.emailTemplates : undefined;
    const templates: Map<TemplateName, CompiledEmail> = new Map<TemplateName, CompiledEmail>();
    for (const name of TEMPLATES) {
      const parts: unknown = isRecord(specifications) ? specifications[name] : undefined;
      if (!isRecord(parts) || PARTS.some((part) => !isRecord(parts[part]))) {
        throw new Error(`The compiled e-mail templates lack the template "${name}".`);
      }
      templates.set(name, {
        subject: runtime.template(parts.subject),
        html: runtime.template(parts.html),
        text: runtime.template(parts.text),
      });
    }
    return new HandlebarsEmailRenderer(templates, webAppUrl);
  }

  /**
   * Method renderCodeEmail
   *
   * @description
   * Renders a code e-mail. The code appears once in each part, grouped as `482 913`; the sign-in
   * subject shows it too, as the mockup does.
   *
   * @param {CodeEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   * @throws {Error} When the template is not loaded or a value is missing.
   */
  public renderCodeEmail(message: CodeEmailMessage): RenderedEmail {
    return this.render(message.template, {
      recipientName: message.recipientName,
      code: message.code.display(),
      validityMinutes: message.validityMinutes,
      webAppUrl: this.webAppUrl,
    });
  }

  /**
   * Method renderInvitationEmail
   *
   * @description
   * Renders the "Invitation" e-mail of the mockup: the inviter and the organization in the
   * subject, the proposed role and the expiry date in the preheader, the button to
   * `<web application>/invite/<invitationId>`. The names are escaped in the HTML part.
   *
   * @param {InvitationEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   * @throws {Error} When the template is not loaded or a value is missing.
   */
  public renderInvitationEmail(message: InvitationEmailMessage): RenderedEmail {
    return this.render('invitation', { ...invitationEmailContext(message, this.webAppUrl) });
  }

  /**
   * Method renderSecurityEmail
   *
   * @description
   * Renders a security e-mail of the "Compte et sécurité" group: the template of its details, the
   * rows "Appareil", "Adresse IP" and "Date" in the time zone of the account (Paris when unknown),
   * the reset link with its token in the fragment, the name of a security key. The values are
   * escaped in the HTML part.
   *
   * @param {SecurityEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   * @throws {Error} When the template is not loaded or a value is missing.
   */
  public renderSecurityEmail(message: SecurityEmailMessage): RenderedEmail {
    return this.render(message.details.template, {
      ...securityEmailContext(message, this.webAppUrl),
    });
  }

  /**
   * Method render
   *
   * @description
   * Renders the three parts of a loaded template with one context.
   *
   * @param {TemplateName} name - The template.
   * @param {Readonly<Record<string, unknown>>} context - Its values.
   * @returns {RenderedEmail} The subject and the two parts.
   * @throws {Error} When the template is not loaded or a value is missing.
   */
  private render(name: TemplateName, context: Readonly<Record<string, unknown>>): RenderedEmail {
    const template: CompiledEmail | undefined = this.templates.get(name);
    if (template === undefined) {
      throw new Error(`The e-mail template "${name}" is not loaded.`);
    }
    return {
      subject: template.subject(context),
      html: template.html(context),
      text: template.text(context),
    };
  }
  // #endregion
}
