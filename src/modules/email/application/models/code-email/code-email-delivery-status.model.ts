/**
 * Type CodeEmailDeliveryStatus
 *
 * @description
 * Where a code e-mail stands in the send log: `queued` until its job sends it (`sent`), finds its
 * code expired (`skipped`) or gives up after its last attempt (`failed`); `skipped` from the start
 * when the event arrived with an expired code or a purpose without template.
 *
 * @type {'queued' | 'sent' | 'skipped' | 'failed'}
 */
export type CodeEmailDeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';
