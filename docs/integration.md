# Domain and integration

[Documentation index](README.md) · [Repository instructions](../AGENTS.md)

**Status:** This page records the target design from repository instructions and skills. Its behavior has not been verified as implemented in this snapshot.

The tables and rules on this page are **target domain behavior**, not proof of a running service or an approved API. Source: `cw-notification-domain` ([Claude](../.claude/skills/cw-notification-domain/SKILL.md), [Codex](../.codex/skills/cw-notification-domain/SKILL.md)). The linked mockup and guides remain the source for product details; confirm ambiguous values before implementation.

## What this service owns

Everything that tells someone something: in the app, by email or on mobile.

**Data**: Notifications and their read state, reminders and their due time, preferences (7 events × 3 channels, digest, Do not disturb), delivery log, the 13 email templates.

**API**: Inbox (list, mark read), reminders (create, snooze, mark done), preferences.

**Events emitted**: `notification.created`, `reminder.due`.

**Events consumed**: `task.assigned`, `comment.created` (mentions), `approval.requested`, `member.invited` (invitation email), `user.signed-up` (verification code), `quota.threshold-reached`.

**External systems**: Email provider, mobile push.

**Mockup screens**: Inbox popover, reminders of the task detail, Compte › Notifications, the Emails artboard.

## Rules this service guards

- Security emails are always sent; notification emails respect preferences and Do not disturb.
- Reminder presets: in 1 hour, this afternoon, tomorrow, next week, the day before the due date, or a chosen date and time (no time in the past).
- Every email carries a manage-notifications link and List-Unsubscribe.

## Notes

A scheduled job sends reminders, digests and due-date alerts.

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). If the mockup disagrees with this guide, update the guide and its source skill for both assistants.

## Contract and delivery sequence

The `cadenway-api-contracts` repository owns HTTP and event specifications. Consumers use published `@cadenway/contracts` packages and `@cadenway/nest-messaging`; do not redefine payloads or connect to another service's database. Change contracts first, then the producing service, followed by gateways and listeners, and finally the webapp. Planned event names on this page must be checked against the actual published specification before use.

## References

[Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE), [integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et), and [repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N). Use [AGENTS.md](../AGENTS.md) as the local source for ownership and hard limits.
