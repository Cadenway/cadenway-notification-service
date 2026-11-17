/**
 * Type SecurityEmailDeliveryStatus
 *
 * @description
 * Where a security e-mail stands in the send log: `queued` until its job sends it (`sent`), finds
 * its window closed (`skipped`) or gives up after its last attempt (`failed`); `skipped` from the
 * start when the event arrived after its window closed.
 *
 * @type {'queued' | 'sent' | 'skipped' | 'failed'}
 */
export type SecurityEmailDeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';
