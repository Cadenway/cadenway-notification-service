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

Decided: cadenway-automation-service calls this service's API for its notify action. The newsletter subscription and the contact form of the public site are received here, in tables without `organization_id`. The mobile channel is stored as a preference and nothing is sent on it while no mobile application exists. This service keeps a projection of user profiles (name, email, time zone, language) from `user.profile-updated` and `user.deleted`. The security emails (sign-in code, reset link, password changed, new sign-in, MFA enabled, account deletion) are triggered by a dedicated family of cadenway-identity-service events; an event carries the single-use, short-lived code or link when the email needs one. This service is the only subscriber allowed on their NATS subjects and keeps the code or link out of its logs and of its send log.

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). When the mockup and this skill disagree, the mockup wins and
this skill is corrected in the same change.
