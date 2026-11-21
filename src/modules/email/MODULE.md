# Email

## Purpose

Sends the e-mails of the service. In this version, seventeen e-mails, from the Emails artboard of the
mockup or new copy in its style, plus a notice for organization quotas:

- "Confirmation de l’adresse" for a code of purpose `email-verification` (sign-up);
- "Code de connexion" for a code of purpose `sign-in` (sign-in without a password);
- the code of purpose `email-change`, sent to the new address of an account (new copy);
- "Invitation" for an invitation to join an organization, sent or sent again;
- the security e-mails of the account events of identity-service: "Réinitialisation du mot de
  passe", "Mot de passe modifié", the notice of a changed address to the previous one (new copy),
  "Nouvelle connexion", "Suppression du compte" and the notice of a cancelled deletion (new copy);
- the security e-mails of the changes of the two-step verification of an account: "Vérification en
  deux étapes activée" and, as new copy, its deactivation, a replaced authenticator app,
  regenerated backup codes, and a security key added or removed;
- a generic activity notice, with an authorized count and no private task content;
- a quota notice for the current administrators of an organization when usage reaches 80%.

It owns the send logs of these e-mails, the content of the ones not sent yet, their templates and
their jobs. It does not own the codes and reset links (identity-service issues, hashes and checks
them), the accounts and sessions (identity-service), the invitations (organization-service owns
them and decides who may accept), the preferences, the inbox or the other templates, which come
with later phases.

## Public entry points

| Entry point                                   | Consumers                      |
| --------------------------------------------- | ------------------------------ |
| `email.module`                                | activity-digests, quota-alerts |
| `public/activity-notice/send-activity-notice` | activity-digests               |
| `public/quota-alert/send-quota-alert-email`   | quota-alerts                   |

`EmailModule` exports `SendActivityNotice` for the activity delivery job. Activity Digests
owns preferences and current authorization checks, and records the send outcome.
Quota Alerts owns the recipient checks and jobs for `SendQuotaAlertEmail`; Email renders and submits the message.

## Owned tables

| Table                         | Holds                                                                                                                                                                                                                                                   | Organization scoping                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `code_email_deliveries`       | The send log: one row per `one-time-code.issued.v1` event (unique `event_id`), with the code, account and event ids, purpose, validity, status, `sent_at`                                                                                               | None: an account has no organization. Policy forced: system transactions only                     |
| `pending_code_emails`         | The code, the address and the cleaned name of a `queued` delivery, deleted when it is settled                                                                                                                                                           | None. Policy forced: system transactions only                                                     |
| `invitation_email_deliveries` | The send log: one row per `invitation.issued.v1` event (unique `(organization_id, event_id)`), with the event and invitation ids, version, proposed role, language, validity, status, `sent_at`                                                         | `organization_id` of the event, first in its tenant index; organization policy of the kit, forced |
| `pending_invitation_emails`   | The invited address, the cleaned names of the inviter and of the organization and the member count of a `queued` delivery, deleted when it is settled                                                                                                   | `organization_id` of its delivery; organization policy of the kit, forced                         |
| `security_email_deliveries`   | The send log: one row per account event (unique `event_id`), with the event and account ids, template (none for a change this version has no e-mail for), language, send window (`occurred_at`, `send_before`), status, `sent_at`                       | None: an account has no organization. Policy forced: system transactions only                     |
| `pending_security_emails`     | The address, the cleaned name and the time zone of a `queued` delivery, its `details` (device, IP address, new address, deletion date, backup codes left, name of a security key) and, for a reset e-mail only, its `token`; deleted when it is settled | None. Policy forced: system transactions only                                                     |

Created by `migrations/0001_code_email_deliveries.sql`,
`migrations/0002_invitation_email_deliveries.sql` and
`migrations/0003_security_email_deliveries.sql`;
`migrations/0004_two_step_security_emails.sql` admits the two-step templates, the reason
`change-not-supported` and a delivery without template. The jobs live in the `pgboss` schema of
`@cadenway/nest-jobs`, provisioned by `src/migrate.ts`.

## API

None.

## Events emitted

None.

## Events consumed

| Event                                   | Stream, consumer                                                                 | Effect                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `one-time-code.issued.v1`               | `EVENTS_RESTRICTED`, `notification-service__request-code-email`, `new`           | `RequestCodeEmail`: records the delivery; for a code still valid, keeps its content and enqueues one job of `email.send-code`, with the template of its purpose (`email-change` goes to the new address); an expired code is recorded `skipped` and nothing is sent                                                                                       |
| `invitation.issued.v1`                  | `EVENTS`, `notification-service__request-invitation-email`, `new`                | `RequestInvitationEmail`: records the delivery in the organization of the event; for the latest version of a valid invitation, keeps its content, skips the older versions still waiting (`superseded`) and enqueues one job of `email.send-invitation`; an expired or older version is recorded `skipped`                                                |
| `password-reset-link.issued.v1`         | `EVENTS_RESTRICTED`, `notification-service__request-password-reset-email`, `new` | `RequestSecurityEmail` (`password-reset`): records the delivery; for a link still valid, keeps its content and token and enqueues one job of `email.send-security`; an expired link is recorded `skipped`                                                                                                                                                 |
| `user.password-changed.v1`              | `EVENTS`, `notification-service__request-password-changed-email`, `new`          | `RequestSecurityEmail` (`password-changed`): records the delivery and, within a day of the event, keeps its content and enqueues one job of `email.send-security`                                                                                                                                                                                         |
| `user.email-changed.v1`                 | `EVENTS`, `notification-service__request-email-changed-email`, `new`             | `RequestSecurityEmail` (`email-changed`): the same, to `previousEmail`                                                                                                                                                                                                                                                                                    |
| `session.opened-on-new-device.v1`       | `EVENTS`, `notification-service__request-new-device-email`, `new`                | `RequestSecurityEmail` (`new-device`): the same                                                                                                                                                                                                                                                                                                           |
| `user.deletion-scheduled.v1`            | `EVENTS`, `notification-service__request-deletion-scheduled-email`, `new`        | `RequestSecurityEmail` (`deletion-scheduled`): the same                                                                                                                                                                                                                                                                                                   |
| `user.deletion-cancelled.v1`            | `EVENTS`, `notification-service__request-deletion-cancelled-email`, `new`        | `RequestSecurityEmail` (`deletion-cancelled`): the same                                                                                                                                                                                                                                                                                                   |
| `user.two-step-verification-changed.v1` | `EVENTS`, `notification-service__request-two-step-email`, `new`                  | `RequestSecurityEmail` (the template of `change`: `two-step-enabled`, `two-step-disabled`, `authenticator-app-replaced`, `backup-codes-regenerated`, `security-key-added`, `security-key-removed`): the same; a `change` this version does not know is recorded `skipped` (`change-not-supported`), without template, content or job, and nothing is sent |

The seven account events are consumed by `AccountSecurityEventsHandler`, one durable consumer
each, granted by these exact names in cadenway-ops. `password-reset-link.issued.v1` is restricted
like `one-time-code.issued.v1` below (it is in `RESTRICTED_EVENT_NAMES`): published on
`restricted.password-reset-link.issued.v1`, read by this service only, its dead letter without
body. The six notices are not restricted: they carry no secret, but the address, the name, the
device and the IP address of the account, and the name of a security key, which a dead letter
keeps 30 days in `EVENTS_DLQ`. The operator reads which event failed; the e-mail is not replayed.
`deliverPolicy: 'new'` on each: a new consumer does not replay the seven days its stream keeps,
which would send old security e-mails again.

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
- The reset token never reaches a log line, the send log, a job payload or an error message: it
  waits in the `token` column of `pending_security_emails` only (never in `details`), until the
  delivery is settled, and never more than the 5 minutes of a sweep after the link expired.
  `ResetLinkToken` masks itself when converted to a string or serialized. The address, the name,
  the device, the IP address and the name of a security key of a security e-mail never reach a
  log line, the send log or a job payload either: they wait in `pending_security_emails` only, at
  most a day and 5 minutes after the event (`SendWindow`, and a check constraint of
  `security_email_deliveries`). The handler logs the id of a key added or removed, never its name.
- A code, a reset link or an invitation whose `expiresAt` has passed is never sent, neither when
  the event arrives nor at a later attempt of its job (contracts of `one-time-code.issued.v1`,
  `password-reset-link.issued.v1` and `invitation.issued.v1`). A security notice is sent within a
  day of its event, or not at all (`skipped`, `expired`).
- A change of the two-step verification sends the e-mail of its `change`, and one this version does
  not know sends nothing (contract of `user.two-step-verification-changed.v1`): it is recorded
  `skipped` for `change-not-supported`, with no template, which a check constraint ties to that
  reason.
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
- The code e-mails and the account e-mails are security e-mails ("Sécurité · toujours envoyé"):
  always sent, whatever the preferences, in French whatever the language of the event, and with no
  `List-Unsubscribe` header nor link, since they cannot be turned off. The invitation e-mail
  retains its existing headers. The activity notice links to notification preferences, where the
  recipient can turn activity emails off.
- The names in an e-mail were typed by people, or read from a `User-Agent` the browser writes: the
  name of the recipient, the names of the inviter and of the organization of an invitation, the
  browser, the operating system and the IP address of a security e-mail, and the name of a security
  key, are kept without controls, format characters or line breaks (`greetingName`), and escaped in
  the HTML part. An e-mail greets
  without a name when nothing is left; an invitation goes to the address alone.
- A security e-mail repeats the device and the IP address only when they look like what they claim
  to be (`client-text.policy`): a product name of letters, digits and a few signs, no domain and
  four digits at most; a numeric version; an IPv4 or IPv6 address. Anything else reads as unknown
  ("Navigateur inconnu", "Adresse inconnue"): the reset e-mail can be asked for any address without
  signing in, from a browser that writes its own `User-Agent`, and a genuine e-mail of Cadenway
  must not carry a text an attacker chose, such as a phone number or a domain. An unknown device
  type reads as `unknown`, as the contract asks. For the same reason, the name of a security key is
  shown only when it looks like the name of a device (`security-key-name.policy`: letters,
  digits, spaces and a few signs, no domain, four digits at most); otherwise the e-mail names no key
  ("Une clé de sécurité vient d’être ajoutée"), since whoever holds a session of the account
  chooses it.
- A code e-mail of purpose `email-change` goes to the new address the event names. The send log
  may still hold `purpose-not-supported` on such codes recorded before this version: no version
  reads it back.

## Transactions

- The handler of `one-time-code.issued.v1` runs in the system transaction of the deduplicator (the
  event has no organization); `RequestCodeEmail` joins it through `CodeEmailUnitOfWork`, so the
  processed id, the delivery, its content and its job commit together, or the event is redelivered.
- The handler of `invitation.issued.v1` runs in the tenant transaction of the deduplicator;
  `RequestInvitationEmail` joins it through `InvitationEmailUnitOfWork`, so the processed id, the
  claimed version, the delivery, its content, the superseded deliveries and the job commit
  together. `tests/code-email.int-spec.ts` and `tests/invitation-email.int-spec.ts` prove that a
  rollback after the enqueue leaves no delivery, content or job.
- The seven handlers of `AccountSecurityEventsHandler` run in the system transaction of the
  deduplicator (the events have no organization); `RequestSecurityEmail` joins it through
  `SecurityEmailUnitOfWork`, so the processed id, the delivery, its content and its job commit
  together, or the event is redelivered.
- The jobs `email.send-code`, `email.send-invitation` and `email.send-security` send outside any
  transaction: they read the
  delivery, render the template, hand the e-mail to the SMTP server unless pg-boss gave up on the
  attempt (`signal`), then mark the delivery `sent` and delete its content in a transaction of
  their unit of work. Delivery is at least once: a crash between the SMTP answer and the mark sends
  the e-mail again, with the same `Message-ID`.
- `email.send-code` and `email.send-security`: five attempts, from 10 seconds apart up to 2
  minutes, 120 seconds each; `email.send-invitation`: five attempts, from 30 seconds apart, within
  about 15 minutes, 120 seconds each (`src/config/job-queues.ts`). When rendering or sending fails
  on the last one, the delivery is marked `failed` and its content deleted, and the job moves to its
  dead-letter queue, kept a day, which the dead-letter watch of the kit reports as an error line.
  The dead letter holds the delivery id only: the operator checks the SMTP server, and the user asks
  for a new code or link or the inviter sends the invitation again; the job is not replayed, and a
  lost notice is not sent again.
- The sweep `email.expire-codes` (`ExpireCodeEmails`, every 5 minutes in UTC) settles in one system
  transaction the `queued` deliveries whose code expired (`for update skip locked`, 1000 at a time)
  and deletes every expired content: what a job deleted before it started, or a last attempt failed
  by a crash or a timeout, leaves behind. The sweep `email.expire-invitations`
  (`ExpireInvitationEmails`, every hour in UTC) does the same for the invitation e-mails, and
  `email.expire-security` (`ExpireSecurityEmails`, every 5 minutes in UTC) for the security
  e-mails whose window closed.

## Decisions

- **Activity notice.** The generic subject accompanies an authorized count and authenticated app
  links. French follows the style of the Emails artboard. English follows the current account's
  language tag, with French for other languages. The message is built in memory and sent using an
  occurrence-derived Message-ID before the authorization expires. The notification preferences
  footer opens the account settings page. There is no direct unsubscribe endpoint for activity
  notices, so they advertise no automated unsubscribe action.

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
- **Copy of the address-change code.** New copy in the style of "Code de connexion" (the artboard
  has no template for it): subject "Confirmez votre nouvelle adresse e-mail", heading "Confirmez
  votre nouvelle adresse", the code block valid 15 minutes, and "Vous n’avez rien demandé ? Ignorez
  cet e-mail : l’adresse du compte ne changera pas." The code is not in the subject.
- **Copy of the security e-mails.** French, from the "Compte et sécurité" group of the Emails
  artboard, with these changes: the rows "Appareil", "Adresse IP" and "Date" replace "Lieu
  (approximatif)" (no place is derived from the IP address); the reset link is valid 30 minutes,
  not the "1 heure" of the mockup, and its token sits in the fragment (`/reset#token=<token>`), so
  that no server receives or logs it; "Mot de passe modifié" states what happened to the sessions
  from `method` and `closedSessionCount` ("vos {n} autres sessions ont été fermées", "votre autre
  session a été fermée", or "Vos autres sessions restent ouvertes.", the wording of the reset
  screen) instead of the fixed "3"; the subject of "Nouvelle connexion" names the browser and the
  operating system without versions and falls back on "Nouvelle connexion à votre compte Cadenway"
  when either is unknown; "Suppression du compte" counts its delay from `deleteAt` and leaves out
  the note about exporting the data, since no export exists yet. The notice of a changed address
  (to the previous one) and of a cancelled deletion are new copy in the style of "Mot de passe
  modifié". The notice of a changed address offers no link to revert the change: the contract has
  none; it points to the sessions and to the administrator.
- **Copy of the two-step e-mails.** "Vérification en deux étapes activée" is the template of the
  artboard with these changes: "codes de secours", the name the interface gives them (Compte ›
  Sécurité et connexion, the setup dialog), replaces "codes de récupération" in the row, the
  preheader and the note; the rows "Appareil" and "Adresse IP" join "Méthode", "Codes de secours"
  ("{n} codes générés", from `backupCodesRemaining`) and "Activée le"; the note adds "Cadenway ne
  les affichera plus"; a "Ce n’était pas vous ?" paragraph follows, as the contract asks of each
  two-step e-mail; and the button reads "Gérer la vérification en deux étapes" instead of "Voir
  mes codes de récupération", since the codes are shown once, when they are generated. The e-mails of
  `disabled`, `authenticator-app-replaced`, `backup-codes-regenerated` ("{n} codes inutilisés sur
  10", the wording of the interface), `security-key-added` and `security-key-removed` (naming the
  key) are new copy in the same frame and tone, with the rows "Appareil", "Adresse IP" and "Date",
  a "Ce n’était pas vous ?" paragraph and the same button. No subject names a key.
- **Frame of the security e-mails.** "Sécurité · toujours envoyé", the label of the artboard, in the
  header; "E-mail de sécurité lié à votre compte : il ne peut pas être désactivé." in the footer;
  no `List-Unsubscribe`, since nothing can turn them off. The code e-mails share it.
- **Send window of the notices.** The contracts give the notices no expiry; this service sends one
  within a day of its event (`noticeWindow`) and skips it after: a day covers the retries and an
  outage of the SMTP server, and bounds how long the address, the device and the IP address wait
  in `pending_security_emails`.
- **Dates.** In the time zone of the account (`timeZone` of the event), "(heure de Paris)" for
  Paris as the mockup writes it and the offset elsewhere ("(UTC−5)"); a zone the runtime does not
  know reads as Paris.
- **Language.** Every recipient gets French, whatever the `language` of the event: the mockup has
  no other language; the send logs keep that language.
- **Links.** `WEB_APP_URL` (default `http://app.cadenway.localhost`, the local stack) builds
  `List-Unsubscribe`, the "Ouvrir la page de connexion" button (`/login/code`, the link of the
  mockup), the "Rejoindre" button (`/invite/<invitationId>`, the link the contract of
  `invitation.issued.v1` describes), the reset link (`/reset#token=<token>`), "Sécuriser mon
  compte" (`/forgot`), "Vérifier mes sessions" and "Gérer la vérification en deux étapes"
  (`/account/security`) and "Annuler la suppression" (`/account`), the paths of the artboard and
  of the contracts.
- **SMTP.** `nodemailer`, one connection per e-mail, 10-second connection and greeting timeouts,
  STARTTLS required as soon as an account is set, no file or URL access, no logger. An SMTP error
  leaves as `EmailNotSentError` with its codes only.
- **Tables without organization.** The two code tables and the two security tables belong to
  accounts: no `organization_id`, and a policy that admits the system runner only, forced. The
  pending tables are keyed by their delivery and written once, so they have no `id`, `version` or
  `updated_at` of their own. `pending_security_emails.details` is JSON read back through a schema
  of the repository, since its members depend on the template; the token has a column of its own.
- **Shared ports.** The invitation and security e-mails reuse the clock, the SMTP sender and the
  rendered-e-mail models of the `code-email` area, and the same `HandlebarsEmailRenderer`
  implements the three renderer ports.
- **One handler for the account events.** `AccountSecurityEventsHandler` registers the seven
  consumers, each mapping its event to `RequestSecurityEmail`: one place logs their outcome with ids
  only. The template of a two-step change is chosen by the domain (`twoStepEmailTemplate`), not by
  the handler, so that a change this version does not know reaches the use case and is recorded.
- **Open.** How long the send logs are kept is not decided: their rows hold ids, a purpose, a
  role or a template, a language tag and dates only, and nothing deletes them yet.
