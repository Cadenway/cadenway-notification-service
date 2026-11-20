# Reminders

## Purpose

Owns personal task reminders, their schedules and their firing and completion state. Task owns the
task identity and its access rules.

## Public entry points

| Entry point | Consumers |
| ----------- | --------- |
| None        | None      |

## Owned tables

This module owns `reminders`, `reminder_generations` and `reminder_authorization_attempts`.
Migrations `0005` and `0006` enforce tenant isolation with forced row-level security.

## API

`openapi/internal/notification-service.yaml` defines the internal routes. The API gateway verifies
current task access and supplies the signed user and organization. Candidate routes return only
identifiers, even before the task check. The selected read verifies the original owner generation
and exact reminder/task pairs before returning private notes.

| Method and path                         | Operation                            |
| --------------------------------------- | ------------------------------------ |
| `GET /reminders`                        | Page pending reminder references     |
| `POST /reminders/visible`               | Read already-authorized references   |
| `GET /tasks/{taskId}/reminder`          | Read the pending reminder for a task |
| `PUT /tasks/{taskId}/reminder`          | Set the pending reminder for a task  |
| `GET /reminders/{reminderId}/candidate` | Resolve a reminder reference         |
| `GET /reminders/{reminderId}`           | Read a personal reminder             |
| `PATCH /reminders/{reminderId}`         | Update a pending reminder's note     |
| `DELETE /reminders/{reminderId}`        | Delete a reminder and its schedule   |
| `POST /reminders/{reminderId}/snooze`   | Postpone a pending reminder          |
| `POST /reminders/{reminderId}/complete` | Complete a reminder                  |

## Events emitted

`notification.delivery-authorization-requested.v1` requests authorization from Task.
`reminder.due.v1` records a permitted delivery. Both are written through the
transactional outbox and carry no reminder note or task display data.

## Events consumed

`task.notification-delivery-authorized.v1` is consumed by
`notification-service__reminder-task-delivery-authorized`. A pg-boss job reloads the reminder
and its schedule revision at the scheduled instant and on bounded authorization retries.

## Invariants

- Each organization, user and task has at most one pending reminder. Completion frees that slot.
  The database must enforce the uniqueness of incomplete reminders under concurrent scheduling.
- New or changed times are in the future. A changed time clears the previous firing and advances
  the schedule revision. Note-only edits preserve that revision, and exact repeats preserve the
  record version.
- Missing, completed, superseded or already-fired schedules produce no additional due fact. Read
  and delivery require current access to the task. Omit inaccessible tasks from lists and counts,
  conceal them on individual routes, and defer delivery while access cannot be verified.

## Transactions

Write the reminder and its durable schedule in one tenant transaction. The handler locks the current
record, checks the scheduled revision and delivery eligibility, and writes the fired state and outbox
fact together. A retry after commit does not emit another due fact.

## Decisions

Jobs carry the organization, owner, reminder identifier and schedule revision. Retry jobs also
carry an attempt identifier and counter. Task decides delivery using its current access rules.
An expired attempt can be replaced up to the retry limit. An explicit denial stops the chain.
