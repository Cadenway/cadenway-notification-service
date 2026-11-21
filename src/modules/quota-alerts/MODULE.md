# Quota Alerts

## Purpose

Sends an email when Billing reports a committed organization quota crossing. Organization owns current
administrator eligibility, Identity owns verified addresses, and Notification Preferences owns email preferences.

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

The signed tenant claim comes from the event or job scope. Discovery reads at most 100 accounts in
one page and the retained job ID deduplicates each recipient for the crossing. Each delivery checks
the current Billing email preference, verified Identity address, and live Organization membership, in
that order, before SMTP. Unavailable authorities cause a retry. Disabled, removed, or missing recipients
complete without mail. Queue data contains no addresses or profile fields.

## Transactions

The first job joins the kit's tenant receipt transaction. Each discovery job commits one page of
recipient jobs and its continuation in one transaction after the Organization call. Delivery reads
preferences in a short tenant transaction before external calls. SMTP uses the job ID as the stable
Message-ID. A retry after a lost SMTP acknowledgement can result in another copy.

## Decisions

Workers and subscription are enabled when Organization, Identity and the Notification signer are
configured. The quota queue retries four times with backoff starting at ten seconds and capped at two
minutes. Exhausted jobs go to the queue's dead-letter queue. Completed jobs and dead letters are kept
for seven days. Operators enable the consumer before Billing starts publishing crossings.
