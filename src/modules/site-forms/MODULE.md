# Site forms

## Purpose

Defines the domain inputs for the site's contact form and newsletter signup. Gateway owns public
routing and rate limits. Notification owns support delivery and subscriber state.

## Contract surface

The two internal POST routes use `@cadenway/contracts` and accept the exact signed Gateway system
actor without an organization. A new contact submission requires a configured support mailbox.
Contact retries are classified against the existing receipt even while support delivery is
unavailable. The newsletter route returns the same empty receipt for each valid submission.

## Owned tables

- `site_contact_receipts` stores the hashed retry identity and content fingerprint with a 24-hour
  replay window.
- `site_contact_submissions` stores the contact message separately from its receipt, with a stable
  delivery identity and a pending, sent or failed status. PostgreSQL `json` retains the exact
  accepted message before delivery.
- `site_newsletter_subscriptions` stores each canonical mailbox and its current state.

The three tables are global. Migration `0009_public_site_submissions.sql` forces RLS with a
system-only policy. Migration `0010_site_contact_recovery_lookup.sql` indexes pending delivery
recovery by the last check time.

## Invariants

- Contact accepts the five site subjects and checks message length by Unicode code point.
- Newsletter canonicalization lowercases the domain and preserves the mailbox local part.
- Repeated newsletter signup preserves the subscriber's current state.
- Contact retries are bound to the submitted operation key and the validated content fingerprint.
- Contact admission commits the receipt, submission and pg-boss job together. A job contains only
  the submission UUID. The worker reads the pending row, delivers through the Email module outside
  the transaction and settles by UUID. The configured support mailbox receives a plain-text message
  with a stable Message-ID and the visitor's address as Reply-To.
- `site.recover-contact` clears expired receipts and checks pending submissions in batches of 50
  every 15 minutes. A pending submission left untouched for 25 hours uses its original occurrence
  key to recover the job after pg-boss removes it. Each inspection advances the scan to the next
  batch. Automatic re-enqueueing pauses while the support address is absent.
- When a delivery exhausts its attempts, the submission remains the source of the message and its
  failure state. The operations team investigates the `email.send-site-contact.dead-letter` UUID
  against the matching submission and checks SMTP acceptance and the prior job state. Once
  delivery is restored and the prior job can be recovered, an authorized system transaction
  resets the failed submission to pending and enqueues its original `submissionId` using
  the same occurrence key. SMTP retries keep the same Message-ID and can repeat a message
  when the server accepted it without a reply.
