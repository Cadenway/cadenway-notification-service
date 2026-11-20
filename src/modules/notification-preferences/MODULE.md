# Notification preferences

## Purpose

Owns the account's channel choices, email cadence and mobile quiet-hours setting. Email delivery
and security notices belong to the email capability.

## Public entry points

| Entry point                                         | Consumers |
| --------------------------------------------------- | --------- |
| `public/preferences/is-in-app-notification-enabled` | inbox     |

## Owned tables

Migration `0005` adds `notification_preferences`, keyed by the verified account. An organization
switch keeps the same account preferences.

## API

`openapi/internal/notification-service.yaml` defines
`GET /internal/v1/me/notification-preferences` and
`PATCH /internal/v1/me/notification-preferences`. The authenticated gateway user is the owner,
regardless of the selected organization.

## Events emitted

None.

## Events consumed

None.

## Invariants

- The settings cover seven categories with independent in-app, email and mobile flags. A read
  before the first effective write returns version-one defaults without creating a record.
- A partial update preserves omitted settings and rejects null values. An effective write advances
  the version and an unchanged request preserves it.
- Do not disturb applies to mobile delivery. Persist mobile choices while the mobile application is
  absent. Security email is independent of these preferences.

## Transactions

Serialize writes per account. Validate the version and apply the patch in the same account-scoped
transaction, including the first effective write against the default version.
Inbox reads one current channel flag in the recipient's delivery transaction, using the same
account lock as preference updates and a transaction-local, read-only recipient policy.

## Decisions

Use the settings screen's cadence specified by the P4 contract. Daily digests run on weekdays at
09:00 and weekly digests run on Mondays at 09:00 in the account's time zone. Digest scheduling and
delivery require a separate runtime binding.
