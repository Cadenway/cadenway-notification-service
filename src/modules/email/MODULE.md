# Email

## Purpose

Sends the e-mails of the service. In this version, three e-mails of the Emails artboard of the
mockup:

- "Confirmation de l’adresse" for a code of purpose `email-verification` (sign-up);
- "Code de connexion" for a code of purpose `sign-in` (sign-in without a password);
- "Invitation" for an invitation to join an organization, sent or sent again.

It owns the send logs of these e-mails, the content of the ones not sent yet, their templates and
their jobs. It does not own the codes (identity-service issues, hashes and checks them), the
invitations (organization-service owns them and decides who may accept), the preferences, the
inbox or the other ten templates, which come with later phases.

## Public entry points

None. `EmailModule` is registered by `src/app.module.ts`; no other module imports it.

## Owned tables

| Table                         | Holds                                                                                                                                                                                           | Organization scoping                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `code_email_deliveries`       | The send log: one row per `one-time-code.issued.v1` event (unique `event_id`), with the code, account and event ids, purpose, validity, status, `sent_at`                                       | None: an account has no organization. Policy forced: system transactions only                     |
| `pending_code_emails`         | The code, the address and the cleaned name of a `queued` delivery, deleted when it is settled                                                                                                   | None. Policy forced: system transactions only                                                     |
| `invitation_email_deliveries` | The send log: one row per `invitation.issued.v1` event (unique `(organization_id, event_id)`), with the event and invitation ids, version, proposed role, language, validity, status, `sent_at` | `organization_id` of the event, first in its tenant index; organization policy of the kit, forced |
| `pending_invitation_emails`   | The invited address, the cleaned names of the inviter and of the organization and the member count of a `queued` delivery, deleted when it is settled                                           | `organization_id` of its delivery; organization policy of the kit, forced                         |

Created by `migrations/0001_code_email_deliveries.sql` and
`migrations/0002_invitation_email_deliveries.sql`. The jobs live in the `pgboss` schema of
`@cadenway/nest-jobs`, provisioned by `src/migrate.ts`.

## API

None.

## Events emitted

None.

## Events consumed

| Event                     | Stream, consumer                                                       | Effect                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `one-time-code.issued.v1` | `EVENTS_RESTRICTED`, `notification-service__request-code-email`, `new` | `RequestCodeEmail`: records the delivery; for `email-verification` and `sign-in` with a code still valid, keeps its content and enqueues one job of `email.send-code`; an expired code or `email-change` is recorded `skipped` and nothing is sent                                                         |
| `invitation.issued.v1`    | `EVENTS`, `notification-service__request-invitation-email`, `new`      | `RequestInvitationEmail`: records the delivery in the organization of the event; for the latest version of a valid invitation, keeps its content, skips the older versions still waiting (`superseded`) and enqueues one job of `email.send-invitation`; an expired or older version is recorded `skipped` |

`one-time-code.issued.v1` is restricted: it is listed in `restrictedEvents`
(`RESTRICTED_EVENT_NAMES` of `@cadenway/contracts/events/identity-service`), published by
identity-service on `restricted.one-time-code.issued.v1`, and this service is the only NATS user
allowed to read its stream. The kit validates it with `eventSchemas` and deduplicates it with the
PostgreSQL deduplicator. A dead letter of this consumer, in `EVENTS_DLQ`, keeps its headers only:
the operator reads which event failed (`Nats-Msg-Id`, the event id) and lets the user ask for a
new code; a code is never replayed, it expires within minutes. An event whose `expiresAt` does not
come after its `occurredAt`, or that carries an organization, breaks the contract and ends there
too.

`invitation.issued.v1` is not restricted: organization-service publishes it on
`evt.invitation.issued.v1`, since the invitation id of the link is not a capability (only the
account whose verified address is the invited one accepts it). The kit validates it, deduplicates
it and runs the handler in a tenant transaction of its organization; `claimVersion` on
`invitation:<invitationId>` keeps the latest version received. `deliverPolicy: 'new'`: a new
consumer does not replay the seven days of invitations `EVENTS` keeps, which would e-mail them
again; the durable consumer then resumes where it stopped across restarts, and an invitation
issued before it first existed is not e-mailed (the inviter sends it again with "Renvoyer"). An
event whose `expiresAt` does not come after its `occurredAt` and within 8 days (the 7 days of the
contract and a day of tolerance) breaks the contract and becomes a dead letter. A dead letter keeps
its body, in `EVENTS_DLQ` for 30 days: the operator reads which invitation failed, and the inviter
sends it again; the event is not replayed.

## Invariants

- The code and the address never reach a log line, the send log, a job payload or an error
  message: they wait in `pending_code_emails` only, from the event until the delivery is settled
  (`sent`, `skipped` or `failed`), and never more than the 5 minutes of a sweep after the code
  expired. `OneTimeCode` masks itself when converted to a string or serialized.
- The invited address and the names of an invitation never reach a log line, the send log or a
  job payload: they wait in `pending_invitation_emails` only, until the delivery is settled, and
  never more than the hour of a sweep after the invitation expired, at most 8 days after it was
  sent (`InvitationValidity`, and a check constraint of `invitation_email_deliveries`).
- A code or an invitation whose `expiresAt` has passed is never sent, neither when the event
  arrives nor at a later attempt of its job (contracts of `one-time-code.issued.v1` and
  `invitation.issued.v1`).
- One delivery per event: the event id is unique in its send log, so a redelivery the
  deduplicator would not catch enqueues nothing. One job per delivery: its occurrence key is the
  delivery id. A resend of an invitation is a new event, with the next version, and sends again.
- Only the latest version of an invitation is sent: an older version is recorded `superseded`, and
  a newer one supersedes the older deliveries still `queued`. A job already running when a resend
  arrives may still send its e-mail: two e-mails then leave, the latter with the new expiry.
- An invitation e-mail is read and written in the organization of its event only: the handler and
  the job run in tenant transactions of that organization (the job handler sets the organization
  the service recorded when it enqueued the job). The hourly sweep is the one exception: a system
  transaction across organizations, which only settles expired deliveries and deletes expired
  contents.
- The code e-mails are security e-mails: always sent, whatever the preferences; `List-Unsubscribe`
  to Compte › Notifications, never `List-Unsubscribe-Post`. The invitation e-mail carries both, as
  every e-mail that is not a security one (cw-email-templates); no preference holds it back yet.
- The names in an e-mail were typed by people: the name of the recipient of a code, the names of
  the inviter and of the organization of an invitation are kept without controls, format
  characters or line breaks (`greetingName`), and escaped in the HTML part. An e-mail greets
  without a name when nothing is left; an invitation goes to the address alone.
- `email-change` is not sent yet: recorded `skipped` with `purpose-not-supported`, logged at `warn`.

## Transactions

- The handler of `one-time-code.issued.v1` runs in the system transaction of the deduplicator (the
  event has no organization); `RequestCodeEmail` joins it through `CodeEmailUnitOfWork`, so the
  processed id, the delivery, its content and its job commit together, or the event is redelivered.
- The handler of `invitation.issued.v1` runs in the tenant transaction of the deduplicator;
  `RequestInvitationEmail` joins it through `InvitationEmailUnitOfWork`, so the processed id, the
  claimed version, the delivery, its content, the superseded deliveries and the job commit
  together. `tests/code-email.int-spec.ts` and `tests/invitation-email.int-spec.ts` prove that a
  rollback after the enqueue leaves no delivery, content or job.
- The jobs `email.send-code` and `email.send-invitation` send outside any transaction: they read the
  delivery, render the template, hand the e-mail to the SMTP server unless pg-boss gave up on the
  attempt (`signal`), then mark the delivery `sent` and delete its content in a transaction of
  their unit of work. Delivery is at least once: a crash between the SMTP answer and the mark sends
  the e-mail again, with the same `Message-ID`.
- `email.send-code`: five attempts, from 10 seconds apart up to 2 minutes, 120 seconds each;
  `email.send-invitation`: five attempts, from 30 seconds apart, within about 15 minutes, 120
  seconds each (`src/config/job-queues.ts`). When rendering or sending fails on the last one, the
  delivery is marked `failed` and its content deleted, and the job moves to its dead-letter queue,
  kept a day, which the dead-letter watch of the kit reports as an error line. The dead letter
  holds the delivery id only: the operator checks the SMTP server, and the user asks for a new code
  or the inviter sends the invitation again; the job is not replayed.
- The sweep `email.expire-codes` (`ExpireCodeEmails`, every 5 minutes in UTC) settles in one system
  transaction the `queued` deliveries whose code expired (`for update skip locked`, 1000 at a time)
  and deletes every expired content: what a job deleted before it started, or a last attempt failed
  by a crash or a timeout, leaves behind. The sweep `email.expire-invitations`
  (`ExpireInvitationEmails`, every hour in UTC) does the same for the invitation e-mails.

## Decisions

- **Templates.** Each template folder holds `html.mjml`, `text.hbs` and `subject.hbs`.
  `scripts/build-email-templates.mjs` compiles the MJML with `mjml-core` and `mjml-preset-core`
  (development dependencies; `mjml` itself is refused by the trust policy of pnpm), with strict
  validation, then precompiles the three parts with Handlebars in strict mode, into
  `infrastructure/adapters/templates/generated/email-templates.js`, which is not committed.
  `pnpm build`, `pnpm start:dev` and Vitest run it; the image loads `handlebars/runtime` only.
- **Copy of the code e-mails.** French, from the two templates of the Emails artboard, adapted to a
  6-digit code valid 10 minutes: the code block of "Code de connexion" ("Valable 10 minutes, une
  seule fois") replaces the link of "Confirmation de l’adresse", and every mention of the validity
  reads as the lifetime of the code, which a delayed attempt does not make false; the workspace
  lines are removed (an account has no workspace at sign-up), as are the device rows of "Code de
  connexion" (the event carries no device); its warning reads "Ignorez cet e-mail et ne communiquez
  ce code à personne, même à l’assistance", since a sign-in code is asked without a password. The
  sign-in subject shows the code, as in the mockup.
- **Copy of the invitation e-mail.** French, from the "Invitation" template of the Emails artboard:
  the subject, the preheader with the proposed role and the expiry date, the header with the
  initials and "{n} membres", the body, the "Rejoindre {organisation}" button, the expiry note and
  the footer "Vous recevez cet e-mail car un membre d’{organisation} a invité votre adresse.". Left
  out: the "message personnel" quote (the invite dialog has no field for it) and the space count of
  the header (the event does not carry it). The expiry date is the day in Paris, the time zone of
  the mockup: the invitee may have no account, so no time zone of their own. "de" is elided before
  a vowel only. The subject keeps the full names, so long names make it longer than 60 characters.
  The sender stays "Cadenway", not the "Cadenway · Atelier Nord" of the mockup: an organization
  name is typed by anyone who creates one, and the From name would lend it more weight.
- **Language.** Every recipient gets French, whatever the `language` of the event: the mockup has
  no other language; the send logs keep that language.
- **Links.** `WEB_APP_URL` (default `http://app.cadenway.localhost`, the local stack) builds
  `List-Unsubscribe`, the "Ouvrir la page de connexion" button (`/login/code`, the link of the
  mockup) and the "Rejoindre" button (`/invite/<invitationId>`, the link the contract of
  `invitation.issued.v1` describes).
- **SMTP.** `nodemailer`, one connection per e-mail, 10-second connection and greeting timeouts,
  STARTTLS required as soon as an account is set, no file or URL access, no logger. An SMTP error
  leaves as `EmailNotSentError` with its codes only.
- **Tables without organization.** The two code tables belong to accounts: no `organization_id`,
  and a policy that admits the system runner only, forced. `pending_code_emails` and
  `pending_invitation_emails` are keyed by their delivery and written once, so they have no `id`,
  `version` or `updated_at` of their own.
- **Shared ports.** The invitation e-mail reuses the clock, the SMTP sender and the rendered-e-mail
  models of the `code-email` area, and the same `HandlebarsEmailRenderer` implements both renderer
  ports.
- **Open.** How long the send logs are kept is not decided: their rows hold ids, a purpose or a
  role, a language tag and dates only, and nothing deletes them yet.
