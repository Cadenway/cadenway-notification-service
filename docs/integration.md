# Domain and integration

[Documentation index](README.md) · [Repository instructions](../AGENTS.md)

**Status:** This page records the target design from repository instructions and skills. Its behavior has not been verified as implemented in this snapshot.

The tables and rules on this page are **target domain behavior**, not proof of a running service or an approved API. Source: `cw-notification-domain` ([Claude](../.claude/skills/cw-notification-domain/SKILL.md), [Codex](../.codex/skills/cw-notification-domain/SKILL.md)). The linked mockup and guides remain the source for product details; confirm ambiguous values before implementation.

## What this service owns

Everything that tells someone something: in the app, by email or on mobile.

**Data**: Notifications and their read state, reminders and their due time, preferences (7 events × 3 channels, digest, Do not disturb), delivery log, the 13 email templates.

**API**: Inbox (list, mark read), reminders (create, snooze, mark done), preferences.

**Events emitted**: `notification.created`, `reminder.due`.

**Events consumed**: `one-time-code.issued.v1` (sign-up, sign-in and address-change codes, restricted), `password-reset-link.issued.v1` (reset link, restricted), `user.password-changed.v1`, `user.email-changed.v1`, `session.opened-on-new-device.v1`, `user.deletion-scheduled.v1` and `user.deletion-cancelled.v1` (security emails), and `invitation.issued.v1` (invitation email). Planned by the contracts: `user.signed-up.v1`, `user.profile-updated.v1`, `user.email-changed.v1` and `user.deleted.v1` (profile projection). The task, mention, approval and quota emails wait for events that no contract defines yet.

**External systems**: Email provider, mobile push.

**Mockup screens**: Inbox popover, reminders of the task detail, Compte › Notifications, the Emails artboard.

## Rules this service guards

- Security emails are always sent; notification emails respect preferences and Do not disturb.
- Reminder presets: in 1 hour, this afternoon, tomorrow, next week, the day before the due date, or a chosen date and time (no time in the past).
- An email that can be turned off carries `List-Unsubscribe`, to Compte › Notifications, and its one-click form; a notification email also shows the manage-notifications link in its footer. A security email ("Sécurité · toujours envoyé") carries neither header nor link: it cannot be turned off.

## Notes

A scheduled job sends reminders, digests and due-date alerts.

Decided: cadenway-automation-service calls this service's API for its notify action. The newsletter subscription and the contact form of the public site are received here, in tables without `organization_id`. The mobile channel is stored as a preference and nothing is sent on it while no mobile application exists. This service will keep a projection of user profiles (name, email, time zone, language) from `user.signed-up.v1` and `user.profile-updated.v1`, which the contract of identity-service plans for it; it is not built yet. The security emails (sign-in code, reset link, password changed, new sign-in, MFA enabled, account deletion) are triggered by a dedicated family of cadenway-identity-service events; an event carries the single-use, short-lived code or link when the email needs one. This service is the only subscriber allowed on the restricted ones and keeps the code or link out of its logs and of its send log. The first of them, `one-time-code.issued.v1`, carries the 6-digit code of the sign-up (`email-verification`) and of the sign-in without a password (`sign-in`), valid 10 minutes, and the code that confirms a new address (`email-change`), valid 15 minutes and sent to that address, on the restricted stream `EVENTS_RESTRICTED`; `user.signed-up.v1` carries no code. `password-reset-link.issued.v1`, restricted too, carries the token of the reset link, valid 30 minutes, put in the fragment of `<web application>/reset#token=<token>`. The notices `user.password-changed.v1` (which says how many sessions the change closed), `user.email-changed.v1` (sent to the previous address), `session.opened-on-new-device.v1`, `user.deletion-scheduled.v1` and `user.deletion-cancelled.v1` travel on `EVENTS` and carry no secret, but the address, the device and the IP address of the account. Each of these events is one email, in French whatever its language, dated in the time zone of the account (Paris when unknown); no place is derived from the IP address. The address confirmation uses that code, not the link of the "Confirmation de l’adresse" artboard (decision of the auth walking skeleton). The invitation email answers `invitation.issued.v1` of cadenway-organization-service, on `EVENTS`: each event is one email (a resend is a new event, with the next version), nothing is sent once `expiresAt` has passed or for a version older than one already received, and the button points to `<web application>/invite/<invitationId>`.

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). If the mockup disagrees with this guide, update the guide and its source skill for both assistants.

## Engineering standards

These skills fix the engineering standards this service follows. They are target conventions, not proof of an implementation in this snapshot.

| Skill                                                                                                                                                | What it fixes                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cw-database-conventions` ([Claude](../.claude/skills/cw-database-conventions/SKILL.md), [Codex](../.codex/skills/cw-database-conventions/SKILL.md)) | Plural snake_case tables, `id` from `uuidv7()`, `organization_id` first in tenant indexes, `version`, `timestamptz` dates, `text` with `CHECK` for enumerations, forced row-level security, a pool of 5 connections, timeouts per role. |
| `cw-logging-and-tracing` ([Claude](../.claude/skills/cw-logging-and-tracing/SKILL.md), [Codex](../.codex/skills/cw-logging-and-tracing/SKILL.md))    | JSON logs with fixed fields and masking, W3C `traceparent` over HTTP and NATS, the ESM start-up flags, metrics per route and lag alerts, health and shutdown semantics.                                                                 |
| `cw-jobs` ([Claude](../.claude/skills/cw-jobs/SKILL.md), [Codex](../.codex/skills/cw-jobs/SKILL.md))                                                 | Durable jobs on pg-boss through `@cadenway/nest-jobs`: enqueued in the use case transaction, one key per occurrence, bounded retries, a dead-letter queue.                                                                              |
| `cw-email-templates` ([Claude](../.claude/skills/cw-email-templates/SKILL.md), [Codex](../.codex/skills/cw-email-templates/SKILL.md))                | MJML compiled at build time, precompiled Handlebars at run time, text and HTML parts, unsubscribe headers, the suppression list.                                                                                                        |

## Contract and delivery sequence

The `cadenway-api-contracts` repository owns HTTP and event specifications. Consumers use published `@cadenway/contracts` packages and `@cadenway/nest-messaging`; do not redefine payloads or connect to another service's database. Change contracts first, then the producing service, followed by gateways and listeners, and finally the webapp. Planned event names on this page must be checked against the actual published specification before use.

## References

[Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE), [integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et), and [repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N). Use [AGENTS.md](../AGENTS.md) as the local source for ownership and hard limits.
