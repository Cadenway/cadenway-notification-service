# Quota Alerts

## Purpose

Sends email and Inbox notices when Billing reports a committed organization quota crossing.
Organization owns current administrator eligibility, Identity owns verified addresses, and
Notification Preferences owns the recipient's delivery settings.

## Public entry points

None.

## Owned tables

None. The kit owns the consumer receipts and the tenant queue `quota.alert` in `pgboss`.

## API

None.

## Events emitted

None.

## Events consumed

`quota.threshold-reached.v1` on `EVENTS`, durable `notification-service__notify-quota-threshold`.
The consumer starts with new events on first enablement and keeps its position across restarts.
An event from the Billing system principal stages one discovery job in the receipt transaction.
The messaging kit retries receipt failures with backoff and moves exhausted events to `EVENTS_DLQ`.

## Invariants

The signed tenant claim comes from the event or job scope. Discovery reads at most 100 accounts per
page and enqueues separate Inbox and email jobs per recipient and crossing. Inbox retries check the
current Organization role before recording the receipt and `billing.inApp` in one Inbox transaction.
Email retries check `billing.email`, the current verified Identity address, and live Organization
membership in that order. Unavailable authorities cause a retry for the affected channel. A revoked
recipient cannot receive either channel. Queue data contains no addresses or profile fields and the
Inbox job carries only the source event and recipient identifiers.

## Transactions

The first job joins the kit's tenant receipt transaction. Each discovery job commits one page of
recipient jobs and its continuation in one transaction after the Organization call. Inbox commits its
record and outbox fact together, deduplicated by organization, recipient and source event. Email reads
preferences in a short tenant transaction before external calls. SMTP uses the job ID as the stable
Message-ID. A retry after a lost SMTP acknowledgement can result in another email.

## Decisions

Workers and subscription are enabled when Organization, Identity and the Notification signer are
configured. The quota queue retries four times with backoff starting at ten seconds and capped at two
minutes. Exhausted jobs go to the queue's dead-letter queue. Completed jobs and dead letters are kept
for seven days. Operators enable the consumer before Billing starts publishing crossings.
