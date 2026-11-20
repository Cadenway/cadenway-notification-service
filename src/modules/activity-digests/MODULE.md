# Activity Digests

## Purpose

Owns activity email scheduling, from recipient candidates to dispatch occurrences. Notification
Preferences owns account settings, Inbox owns in-app notifications, Identity owns recipient
profiles, Task owns current access to its resources, and Email owns rendering and SMTP delivery.

## Public entry points

| Entry point | Consumers |
| ----------- | --------- |
| None        | None      |

## Owned tables

None yet. The application will own durable candidate and occurrence state.

## API

None.

## Events emitted

None.

## Events consumed

None yet. Future candidate intake follows the published event contracts for eligible activity.

## Invariants

- Derive candidates from immutable source event identities and retain trusted organization,
  recipient account, and source selectors. Register a candidate once per source event and
  recipient. The in-app setting, Inbox row, and read or archive state have no bearing on email
  eligibility. Apply the email preference for each activity category.
- `each` dispatches per eligible event. `daily` runs on weekdays at 09:00 local time, `weekly`
  on Mondays at 09:00 local time, and `never` disables activity mail. The scheduling policy
  uses `Europe/Paris` when no account time zone is set.
- Reserve a digest once per account, cadence, and local date across organizations. Keep this
  identity independent of the time zone and profile version used to compute the dispatch instant.
- Resolve the current verified recipient profile and current email preferences before handing
  anything to SMTP. Recompute the schedule when the stored profile version or time zone changes.
  Skip a missing, inactive, or unverified recipient. Check current Task authorization for each
  item under its own organization and source selectors. Omit inaccessible items and skip empty
  digests. A temporary lookup failure defers the send within the configured retry budget.
- Durable job payloads carry opaque identifiers and versions. Resolve the address, subject, and
  text at delivery time. Activity emails use the applicable unsubscribe headers and link.
- Bound scans with ordered cursor pagination and a page limit. Bound retries and surface
  exhausted jobs through the shared job failure handling.

## Transactions

Candidate intake persists deduplication and candidate state together. The dispatch transaction
reserves the occurrence and enqueues its job atomically. External authorization, profile reads,
and SMTP run outside database transactions. Record the delivery result in a separate transaction.

## Decisions

- The Nest module stays unmounted until there are application providers and published contracts
  for its cross-service reads and event subscriptions.
- Use the Email capability's at-least-once delivery semantics. A failure after SMTP accepts the
  message and before the send is recorded can result in another send with the same `Message-ID`.
  Occurrence deduplication limits scheduling and does not make SMTP delivery exactly once.
