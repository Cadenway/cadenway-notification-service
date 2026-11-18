---
name: cw-email-templates
description: "How cadenway-notification-service builds and sends its emails: MJML compiled at build time, precompiled Handlebars at run time, the text part, unsubscribe headers and the suppression list. Load it before adding or changing an email template or the code that sends one."
---

# Email templates

The 13 emails of the mockup (Emails artboard) are owned by this service. Copy is French and comes
from the mockup; an email the artboard lacks is new copy in its style, listed in the pull request.
Sixteen exist today, in `src/modules/email` (its `MODULE.md`): "Confirmation de l’adresse"
(`email-verification`), "Code de connexion" (`sign-in`), the address-change code (`email-change`),
"Invitation" (`invitation`), and the security emails of the account events: "Réinitialisation du
mot de passe" (`password-reset`), "Mot de passe modifié" (`password-changed`), the notice to the
previous address (`email-changed`), "Nouvelle connexion" (`new-device`), "Suppression du compte"
(`deletion-scheduled`) and the cancelled deletion (`deletion-cancelled`), and the e-mails of the
changes of the two-step verification: "Vérification en deux étapes activée" (`two-step-enabled`)
and, as new copy, `two-step-disabled`, `authenticator-app-replaced`, `backup-codes-regenerated`,
`security-key-added` and `security-key-removed`.

## Build

- A template is a folder of `src/modules/email/infrastructure/adapters/templates/`: `html.mjml` (MJML with
  Handlebars placeholders), `text.hbs` (the text part) and `subject.hbs`. Shared pieces sit in
  `partials/`: a head partial is a whole `<mjml><mj-head>` document included inside the `mj-head`
  of the template (MJML keeps the first `mj-head` only); a body partial is bare MJML.
- `scripts/build-email-templates.mjs` compiles each `html.mjml` once, with strict validation
  (`validationLevel: 'strict'`, `ignoreIncludes: false`), then precompiles the HTML, the text and
  the subject with Handlebars in strict mode, built-in helpers only, into
  `templates/generated/email-templates.js`. The generated module is not committed: `pnpm build`
  writes it before `nest build` copies it into `dist/` (asset of `nest-cli.json`), `pnpm start:dev`
  writes it once, and Vitest writes it in its global setup.
- The MJML compiler is a **dev dependency**: it is never imported by code that runs in the image.
  Production loads `handlebars/runtime` only, with the precompiled templates.
- A template that fails strict validation fails the build; it is never fixed at run time. A value
  missing at render time throws: no placeholder is ever left empty.
- Prettier formats the MJML; it never touches `*.hbs`, whose line breaks are the text part.

### The MJML compiler

`mjml-core` and `mjml-preset-core` (5.4.1) are the development dependencies, the components being
passed as `presets: [presetCore]`. They leave a peer warning: `htmlnano` wants `cssnano ^8.0.0`
while `mjml-core` declares `^7.1.9`; minification is off, so nothing reaches `htmlnano`, and no
`overrides` entry is added for it. `mjml` itself (5.4.1) is not installed: it brings `mjml-cli`,
whose `chokidar@4.0.3` is refused by the `trustPolicy` of `pnpm-workspace.yaml`, and no
`trustPolicyExclude` is added for it.

## Content

- Every email has a text part and an HTML part, written together.
- Subject of 60 characters at most, preheader of 90 at most.
- Dates and times are rendered in the recipient's time zone, "(heure de Paris)" for Paris as the
  mockup writes it and the offset elsewhere ("(UTC−5)"); a time zone the runtime does not know,
  and an invitee, who may have no account yet, get those of Paris, the time zone of the mockup.
- The HTML part escapes the values it receives; the text part and the subject do not.
- A security email shows its frame: "Sécurité · toujours envoyé" in the header and "E-mail de
  sécurité lié à votre compte : il ne peut pas être désactivé." in the footer
  (`partials/security-header.mjml`, `partials/security-footer.mjml`). The rows "Appareil",
  "Adresse IP" and "Date" (`partials/client-rows.mjml`) replace the "Lieu (approximatif)" of the
  mockup: no place is derived from the IP address.

## Headers and consent

- An email that can be turned off carries `List-Unsubscribe`, to Compte › Notifications of the web
  application (`WEB_APP_URL`), and its one-click form `List-Unsubscribe-Post`; a notification email
  also shows the manage-notifications link in its footer.
- A security email, always sent, carries neither header nor link: it cannot be turned off.
- An address on the suppression list is not written to. Bounces and complaints reach the service
  through a signed route and feed that list.
- Sending subdomains are separate; which ones is not decided yet and belongs to cadenway-ops.

## Sending

- SMTP through `nodemailer`, behind a port with a fake for tests; Mailpit receives the mail locally.
  `nodemailer` ships its own types: `@types/nodemailer` is not installed.
- One job per email (`cw-jobs`), with the id of the send as idempotency key. Delivery is at least
  once: SMTP cannot promise "never twice"; the `Message-ID` derives from the id of the send, so a
  second attempt sends the same one.
- A single-use code or link never reaches a log line, the send log or a job payload: it waits in a
  table of its own until the email leaves, then is deleted. An SMTP error leaves with its codes
  only, since its message may quote the recipient.

## Tests

- A template test renders with the mockup fixtures (Atelier Nord, Camille Martin, CAD-482) and
  checks the subject, the preheader, the text part and the escaping of the HTML part; the sender
  decides the unsubscribe headers.
- `tests/code-email.int-spec.ts`, `tests/invitation-email.int-spec.ts` and
  `tests/security-email.int-spec.ts` send through a disposable Mailpit (`compose.dev.yaml`) and
  read the emails back, with their headers, from its HTTP API.
