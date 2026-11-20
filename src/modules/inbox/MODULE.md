# Inbox

## Purpose

Owns each member's inbox, its unread badge, and the read and archive state. Task and resource access
remain with the owning services.

## Public entry points

| Entry point | Consumers |
| ----------- | --------- |
| None        | None      |

## Owned tables

The inbox owns notification records, recipient generations, and delivery authorization attempts
scoped to their organization. An attempt binds one source event and recipient to an immutable
Task key and an exclusive expiry. It stores only the references needed to create the inbox record.

## API

`openapi/internal/notification-service.yaml` defines the following routes under
`/internal/v1/inbox`. The gateway token supplies the verified user and organization.
The gateway checks the recipient's current membership and resource visibility before display.

| Method and path                                | Operation                         |
| ---------------------------------------------- | --------------------------------- |
| `GET /notifications`                           | Page notification candidates      |
| `GET /unread-subjects`                         | Page active unread subject counts |
| `GET /notifications/{notificationId}`          | Read one candidate for visibility |
| `POST /notifications/read-all`                 | Mark visible active records read  |
| `POST /notifications/{notificationId}/read`    | Mark a record read                |
| `POST /notifications/{notificationId}/archive` | Archive a record                  |

## Events emitted

- `notification.delivery-authorization-requested.v1` carries the tenant, recipient, Task selector,
  immutable correlation and exclusive deadline for one request.
- `notification.created.v1` carries the tenant, notification and recipient IDs, Task selector and
  creation time. The realtime gateway checks current authorization before invalidating the inbox.

## Events consumed

Task assignment facts identify the new assignee. Status changes use the committed watcher
audience. Comment creation combines mentions, the eligible reply recipient and watchers. Comment
edits and description mention changes use the newly added recipients. Approval requests go to the
designated reviewers, approval decisions to the requester, task access requests to the space
owner, and task access grants to the requester.

`task.notification-delivery-authorized.v1` completes the matching attempt. The decision durable
starts before source durables and reads retained decisions. The source durables begin with new
facts and keep their position on restarts. The kit validates each event, deduplicates the event ID
and retries failed transactions with its default five deliveries. For a dead letter, inspect the
consumer and source event ID, correct the cause and replay the source fact if still applicable.
An elapsed authorization correlation cannot be revived by replaying a decision.

## Invariants

- The actor is excluded. Deduplicate the recipients and record at most one inbox effect per
  organization, recipient and source event. A mention takes priority over a reply or watcher alert
  when the same comment identifies the same account for more than one reason.
- A candidate audience still requires a current access check before delivery. Inaccessible linked
  resources are omitted from lists, unread counts and read-all. Individual operations conceal
  inaccessible and missing records in the same way. Defer delivery while visibility is unknown.
- Before a permitted inbox write, apply the recipient's in-app channel for the event category.
  Approval has no separate channel in the current preferences catalog.
- Reading and archiving each set their own timestamp once. Archiving excludes an item from the
  unread badge and preserves its read timestamp. A repeat with a current or absent precondition
  preserves the version. Cursors belong to the caller, organization and filter.

## Transactions

Record the inbox effect, source-event deduplication and outbox fact in the same tenant transaction.
Staging a delivery writes its authorization attempt and request outbox fact together. A Task decision
must match the pending correlation in that organization and arrive within both deadlines. The
permit, inbox record and creation fact commit together. A denial closes the attempt. An attempt
without a current permit cannot create an inbox record.

Apply version checks to single-record writes. Read-all changes the records in its snapshot at one
instant and computes the updated unread count in that transaction.

## Decisions

Keep addresses, capabilities, comment text and attachment content out of inbox events. The
gateway resolves comment excerpts against the live comment, so deletion also withdraws the
preview. Independent list and space notices and generic access refusals require their own
authorized boundary.
