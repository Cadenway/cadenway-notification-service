---
name: cw-email-templates
description: "How cadenway-notification-service builds and sends its emails: MJML compiled at build time, precompiled Handlebars at run time, the text part, unsubscribe headers and the suppression list. Load it before adding or changing an email template or the code that sends one."
---

# Email templates

The 13 emails of the mockup (Emails artboard) are owned by this service. Copy is French and comes
from the mockup.

## Build

- A template is written in MJML with Handlebars placeholders. The build compiles it once, with
  strict validation (`validationLevel: 'strict'`, `ignoreIncludes: false`), then precompiles the
  resulting HTML with Handlebars.
- The MJML compiler is a **dev dependency**: it is never imported by code that runs in the image.
  Production loads `handlebars/runtime` only, with the precompiled templates.
- A template that fails strict validation fails the build; it is never fixed at run time.

### The MJML compiler is not installed yet

No template exists, and both ways of installing the compiler were set aside on 2026-11-13. Check
them again when the first template is written, and install nothing that needs a workaround:

- `mjml` (5.4.1) brings `mjml-cli`, whose `chokidar@4.0.3` is refused by the `trustPolicy` of
  `pnpm-workspace.yaml`. No `trustPolicyExclude` is added for it.
- `mjml-core` with `mjml-preset-core` (5.4.1) installs and compiles, the components being passed
  as `presets: [presetCore]`, but leaves a peer warning: its `htmlnano` wants `cssnano ^8.0.0` while
  `mjml-core` declares `^7.1.9`. No `overrides` entry is added for it.

## Content

- Every email has a text part and an HTML part, written together.
- Subject of 60 characters at most, preheader of 90 at most.
- Dates and times are rendered in the recipient's time zone.

## Headers and consent

- Every email carries a manage-notifications link and `List-Unsubscribe`.
- `List-Unsubscribe-Post` (one-click) is added to every email except security emails, which are
  always sent.
- An address on the suppression list is not written to. Bounces and complaints reach the service
  through a signed route and feed that list.
- Sending subdomains are separate; which ones is not decided yet and belongs to cadenway-ops.

## Sending

- SMTP through `nodemailer`, behind a port with a fake for tests; Mailpit receives the mail locally.
  `nodemailer` ships its own types: `@types/nodemailer` is not installed.
- One job per email (`cw-jobs`), with the id of the send as idempotency key. Delivery is at least
  once: SMTP cannot promise "never twice".

## Tests

- A template test renders with the mockup fixtures (Atelier Nord, Camille Martin, CAD-482) and
  checks the subject, the text part and the presence of the unsubscribe headers.
