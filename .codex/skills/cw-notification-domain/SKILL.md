---
name: cw-notification-domain
description: "The data, rules, events and screens cadenway-notification-service owns, taken from the mockup, the integration guide and the repositories document. Load it before naming, modeling or testing anything in this service."
---

# notification-service domain

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
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). When the mockup and this skill disagree, the mockup wins and
this skill is corrected in the same change.
