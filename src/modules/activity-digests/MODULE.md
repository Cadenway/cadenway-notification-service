# Activity Digests

## Purpose

Owns activity email scheduling, from recipient candidates to dispatch occurrences. Notification
Preferences owns account settings, Inbox owns in-app notifications, Identity owns recipient
profiles, Task owns current access to its resources, and Email owns rendering and SMTP delivery.

## Public entry points

| Entry point                          | Consumers |
| ------------------------------------ | --------- |
| activity-digests.module              | inbox     |
| `public/digest/stage-activity-email` | inbox     |

## Owned tables

`activity_email_candidates`, `activity_email_occurrences` and
`activity_email_authorization_attempts` store the private candidate, stable batch and expiring Task
correlation. Durable jobs and these tables hold neither the recipient address nor email content.

## API

None.

## Events emitted

`notification.delivery-authorization-requested.v1` requests current Task access for the exact
tenant, recipient and task selector. Notification owns the request, which Inbox and Reminders
also emit with separate correlations. Task owns the decision.

## Events consumed

- Inbox hands off its trusted Assignment, Mention, Comment, Status Change and Access audience in
  the source event transaction.
- `task.notification-delivery-authorized.v1` is consumed on the dedicated
  `activity-task-delivery-authorized` durable and accepts only a Task system decision for a
  current activity correlation. Inbox keeps its own decision durable.

## Invariants

- Derive candidates from immutable source event identities and retain trusted organization,
  recipient account, and source selectors. Register a candidate once per source event and
  recipient. The in-app setting, Inbox row, and read or archive state have no bearing on email
  eligibility. Apply the email preference for each activity category.
- The source fact's first processing checks the recipient's locked current settings before
  staging. Disabled categories and `never` create no candidate or planning job. Eligibility uses
  the preference at ingestion, with current settings checked again at planning and delivery.
- Do not disturb applies to mobile. Approval has no published email option and remains in-app.
- `each` dispatches per eligible event. `daily` runs on weekdays at 09:00 local time, `weekly`
  on Mondays at 09:00 local time, and `never` disables activity mail. The scheduling policy
  uses `Europe/Paris` when no account time zone is set.
- Reserve a digest once per account, cadence, and local date across organizations. Keep this
  identity independent of the time zone and profile version used to compute the dispatch instant.
  The digest takes up to 100 candidates in creation order. Overflow stays pending for the next
  permitted cycle. New eligible candidates can fill the same future slot until it reaches capacity.
- Resolve the current verified recipient profile and current email preferences before handing
  anything to SMTP. A mobile or in-app preference revision does not move a digest. Revalidate
  each candidate's email category. Recompute the schedule when cadence or recipient profile changes.
  Skip a missing, inactive, or unverified recipient. Check current Task authorization for each
  item under its own organization and source selectors. Omit inaccessible items and skip empty
  digests. A temporary lookup failure defers the send within the configured retry budget.
- Durable job payloads carry opaque identifiers and versions. Resolve the address at delivery
  time. An activity email contains the number of authorized notices and links to the authenticated
  home and the account's notification settings. The current contract has no one-click opt-out.
- Bound scans with ordered cursor pagination and a page limit. Bound retries and surface
  exhausted jobs through the shared job failure handling.

## Transactions

Candidate intake persists deduplication, candidate state and the next planning job together.
Planning reserves the occurrence and enqueues its job atomically. Task authorization attempts
and their outbox records commit together. Profile reads and SMTP run outside database
transactions. Recheck the verified recipient after claiming the send lease and record delivery
in a separate transaction.

## Decisions

- Activating activity email requires both `IDENTITY_SERVICE_URL` and `INTERNAL_TOKEN_PRIVATE_JWK`.
  Run the regular migrator to apply `0008` and provision the new queues. Deploy the matching trust
  at Identity and the dedicated NATS durable permissions before setting the pair. With both
  variables absent, Inbox and the existing email capabilities run without staging activity
  candidates or registering activity consumers and workers. During a mixed rollout, a dormant
  replica can acknowledge the shared Inbox source fact without handing it off to Activity.
  Activity coverage starts once every Notification replica has the pair enabled. Inbox behavior
  stays the same during rollout.
- The account planner receives a transactionally enqueued job when a candidate is staged. It
  reserves at most 100 candidates per pass and enqueues delivery in the same transaction. A
  daily or weekly overflow continuation waits until its current slot has passed. The
  delivery job checks current account settings and Identity profile, requests a fresh Task permit
  within each originating tenant and uses its bounded durable retry budget while a decision is
  pending. A replaced generation, completed occurrence or deleted account cannot send.
- Use the Email capability's at-least-once delivery semantics. A failure after SMTP accepts the
  message and before the send is recorded can result in another send with the same `Message-ID`.
  Occurrence deduplication limits scheduling and does not make SMTP delivery exactly once.
