# Site forms

## Purpose

Defines the domain inputs for the site's contact form and newsletter signup. Gateway owns public
routing and rate limits. Notification owns support delivery and subscriber state.

## Contract surface

The form API follows the site contracts. Contact delivery uses a text message to the configured
support mailbox. The visitor's email address supplies Reply-To. A newsletter reply uses the same
empty receipt for each valid submission.

## Invariants

- Contact accepts the five site subjects and checks message length by Unicode code point.
- Newsletter canonicalization lowercases the domain and preserves the mailbox local part.
- Repeated newsletter signup preserves the subscriber's current state.
- Contact retries are bound to the submitted operation key and the validated content fingerprint.
