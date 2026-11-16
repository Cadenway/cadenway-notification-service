# Email

## Purpose

Sends the e-mails of the service. In this version, the two e-mails that carry a single-use code,
from the Emails artboard of the mockup:

- "Confirmation de l’adresse" for a code of purpose `email-verification` (sign-up);
- "Code de connexion" for a code of purpose `sign-in` (sign-in without a password).

It owns the send log of these e-mails, the content of the ones not sent yet, their templates and
their jobs. It does not own the codes (identity-service issues, hashes and checks them), the
preferences, the inbox or the other eleven templates, which come with later phases.

## Public entry points

None for other capabilities. The Notification root modules compose `EmailModule` for the
combined, API or worker process. The API receives events, enqueues jobs and registers the expiry
schedule. The worker runs the send and expiry jobs and owns the SMTP adapter.

## Owned tables

| Table                   | Holds                                                                                                                                                     | Organization scoping                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `code_email_deliveries` | The send log: one row per `one-time-code.issued.v1` event (unique `event_id`), with the code, account and event ids, purpose, validity, status, `sent_at` | None: an account has no organization. Policy forced: system transactions only |
| `pending_code_emails`   | The code, the address and the cleaned name of a `queued` delivery, deleted when it is settled                                                             | None. Policy forced: system transactions only                                 |

Created by `migrations/0001_code_email_deliveries.sql`. The jobs live in the `pgboss` schema of
`@cadenway/nest-jobs`, provisioned by `src/migrate.ts`.

## API

None.

## Events emitted

None.

## Events consumed

| Event                     | Stream, consumer                                                       | Effect                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `one-time-code.issued.v1` | `EVENTS_RESTRICTED`, `notification-service__request-code-email`, `new` | `RequestCodeEmail`: records the delivery; for `email-verification` and `sign-in` with a code still valid, keeps its content and enqueues one job of `email.send-code`; an expired code or `email-change` is recorded `skipped` and nothing is sent |

The event is restricted: it is listed in `restrictedEvents` (`RESTRICTED_EVENT_NAMES` of
`@cadenway/contracts/events/identity-service`), published by identity-service on
`restricted.one-time-code.issued.v1`, and this service is the only NATS user allowed to read its
stream. The kit validates it with `eventSchemas` and deduplicates it with the PostgreSQL
deduplicator. A dead letter of this consumer, in `EVENTS_DLQ`, keeps its headers only: the operator
reads which event failed (`Nats-Msg-Id`, the event id) and lets the user ask for a new code; a code
is never replayed, it expires within minutes. An event whose `expiresAt` does not come after its
`occurredAt`, or that carries an organization, breaks the contract and ends there too.

## Invariants

- The code and the address never reach a log line, the send log, a job payload or an error
  message: they wait in `pending_code_emails` only, from the event until the delivery is settled
  (`sent`, `skipped` or `failed`), and never more than the 5 minutes of a sweep after the code
  expired. `OneTimeCode` masks itself when converted to a string or serialized.
- A code whose `expiresAt` has passed is never sent, neither when the event arrives nor at a later
  attempt of its job (contract of `one-time-code.issued.v1`).
- One delivery per event: `event_id` is unique, so a redelivery the deduplicator would not catch
  enqueues nothing. One job per delivery: its occurrence key is the delivery id.
- These are security e-mails: always sent, whatever the preferences; `List-Unsubscribe` to
  Compte › Notifications, never `List-Unsubscribe-Post`.
- The name of the recipient was typed before the address was verified: it is kept without
  controls, format characters or line breaks (`greetingName`), and an e-mail greets without a name
  when nothing is left.
- `email-change` is not sent yet: recorded `skipped` with `purpose-not-supported`, logged at `warn`.

## Transactions

- The handler of the event runs in the system transaction of the deduplicator (the event has no
  organization); `RequestCodeEmail` joins it through `CodeEmailUnitOfWork`, so the processed id, the
  delivery, its content and its job commit together, or the event is redelivered.
  `tests/code-email.int-spec.ts` proves that a rollback after the enqueue leaves no delivery, content
  or job.
- The job `email.send-code` sends outside any transaction: it reads the delivery, renders the
  template, hands the e-mail to the SMTP server unless pg-boss gave up on the attempt (`signal`),
  then marks the delivery `sent` and deletes its content in a transaction of `CodeEmailUnitOfWork`.
  Delivery is at least once: a crash between the SMTP answer and the mark sends the e-mail again,
  with the same `Message-ID`.
- Five attempts, from 10 seconds apart up to 2 minutes, 120 seconds each
  (`src/config/job-queues.ts`). When rendering or sending fails on the last one, the delivery is
  marked `failed` and its content deleted, and the job moves to `email.send-code.dead-letter`, kept
  a day, which the dead-letter watch of the kit reports as an error line. The dead letter holds the
  delivery id only: the operator checks the SMTP server, and the user asks for a new code; the job
  is not replayed.
- The sweep `email.expire-codes` (`ExpireCodeEmails`, every 5 minutes in UTC) settles in one system
  transaction the `queued` deliveries whose code expired (`for update skip locked`, 1000 at a time)
  and deletes every expired content: what a job deleted before it started, or a last attempt failed
  by a crash or a timeout, leaves behind.

## Decisions

- **Templates.** Each template folder holds `html.mjml`, `text.hbs` and `subject.hbs`.
  `scripts/build-email-templates.mjs` compiles the MJML with `mjml-core` and `mjml-preset-core`
  (development dependencies; `mjml` itself is refused by the trust policy of pnpm), with strict
  validation, then precompiles the three parts with Handlebars in strict mode, into
  `infrastructure/adapters/templates/generated/email-templates.js`, which is not committed.
  `pnpm build`, `pnpm start:dev` and Vitest run it; the image loads `handlebars/runtime` only.
- **Copy.** French, from the two templates of the Emails artboard, adapted to a 6-digit code valid
  10 minutes: the code block of "Code de connexion" ("Valable 10 minutes, une seule fois") replaces
  the link of "Confirmation de l’adresse", and every mention of the validity reads as the lifetime
  of the code, which a delayed attempt does not make false; the workspace lines are removed (an
  account has no workspace at sign-up), as are the device rows of "Code de connexion" (the event
  carries no device); its warning reads "Ignorez cet e-mail et ne communiquez ce code à personne,
  même à l’assistance", since a sign-in code is asked without a password. The sign-in subject shows
  the code, as in the mockup. Every account gets French, whatever its `language`: the mockup has no
  other language; the send log keeps the language of the account.
- **Links.** `WEB_APP_URL` (default `http://app.cadenway.localhost`, the local stack) builds
  `List-Unsubscribe` and the "Ouvrir la page de connexion" button (`/login/code`, the link of the
  mockup).
- **SMTP.** `nodemailer`, one connection per e-mail, 10-second connection and greeting timeouts,
  STARTTLS required as soon as an account is set, no file or URL access, no logger. An SMTP error
  leaves as `EmailNotSentError` with its codes only.
- **Tables without organization.** The two tables belong to accounts: no `organization_id`, and a
  policy that admits the system runner only, forced. `pending_code_emails` is keyed by its
  delivery and written once, so it has no `id`, `version` or `updated_at` of its own.
- **Open.** How long the send log is kept is not decided: its rows hold ids, a purpose and dates
  only, and nothing deletes them yet.
