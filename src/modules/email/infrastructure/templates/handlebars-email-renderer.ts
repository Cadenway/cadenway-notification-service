import { createRequire } from 'node:module';

import type {
  CodeEmailMessage,
  EmailRenderer,
  RenderedEmail,
} from '../../application/ports/email-renderer.port.js';
import type { CodeEmailTemplate } from '../../domain/code-email.js';

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
 * Constant TEMPLATES
 *
 * @description
 * The templates the service needs; the start-up fails when the generated module lacks one.
 *
 * @type {readonly CodeEmailTemplate[]}
 */
const TEMPLATES: readonly CodeEmailTemplate[] = ['email-verification', 'sign-in'];

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
 * Constant GENERATED_MODULE
 *
 * @description
 * The module `scripts/build-email-templates.mjs` writes next to this file, and that `nest build`
 * copies next to its compiled form in `dist/`.
 *
 * @type {URL}
 */
const GENERATED_MODULE: URL = new URL('./generated/email-templates.js', import.meta.url);

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
 * The French copy is the one of the Emails artboard of the mockup, adapted to a 6-digit code.
 * Every account gets it, whatever its `language`: the mockup has no other language yet.
 */
export class HandlebarsEmailRenderer implements EmailRenderer {
  // #region Properties
  /**
   * Property templates
   *
   * @description
   * The compiled templates, by name.
   *
   * @type {ReadonlyMap<CodeEmailTemplate, CompiledEmail>}
   * @readonly
   */
  private readonly templates: ReadonlyMap<CodeEmailTemplate, CompiledEmail>;

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
   * @param {ReadonlyMap<CodeEmailTemplate, CompiledEmail>} templates - The compiled templates.
   * @param {string} webAppUrl - Origin of the web application, without a trailing slash.
   * @constructor
   */
  private constructor(templates: ReadonlyMap<CodeEmailTemplate, CompiledEmail>, webAppUrl: string) {
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
   * @param {URL} source - The generated module; the one next to this file by default, another one
   * in a test.
   * @returns {Promise<HandlebarsEmailRenderer>} The renderer.
   * @throws {Error} When the module is missing (the templates were not compiled: run
   * `pnpm build`), or lacks a template or a part.
   */
  public static async load(
    webAppUrl: string,
    source: URL = GENERATED_MODULE,
  ): Promise<HandlebarsEmailRenderer> {
    const runtime: HandlebarsRuntime = (
      createRequire(import.meta.url)('handlebars/runtime') as HandlebarsRuntime
    ).create();
    let loaded: unknown;
    try {
      loaded = await import(source.href);
    } catch (error) {
      throw new Error(
        'The e-mail templates are not compiled: run `pnpm build` (or node scripts/build-email-templates.mjs).',
        { cause: error },
      );
    }
    const specifications: unknown = isRecord(loaded) ? loaded.emailTemplates : undefined;
    const templates: Map<CodeEmailTemplate, CompiledEmail> = new Map<
      CodeEmailTemplate,
      CompiledEmail
    >();
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
    const template: CompiledEmail | undefined = this.templates.get(message.template);
    if (template === undefined) {
      throw new Error(`The e-mail template "${message.template}" is not loaded.`);
    }
    const context: Readonly<Record<string, unknown>> = {
      recipientName: message.recipientName,
      code: message.code.display(),
      validityMinutes: message.validityMinutes,
      webAppUrl: this.webAppUrl,
    };
    return {
      subject: template.subject(context),
      html: template.html(context),
      text: template.text(context),
    };
  }
  // #endregion
}
