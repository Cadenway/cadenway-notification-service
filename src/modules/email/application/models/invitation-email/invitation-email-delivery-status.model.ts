/**
 * Type InvitationEmailDeliveryStatus
 *
 * @description
 * Where an invitation e-mail stands in the send log: `queued` until its job sends it (`sent`),
 * finds the invitation expired or a later version known (`skipped`), or gives up after its last
 * attempt (`failed`); `skipped` from the start when the event arrived expired or superseded.
 *
 * @type {'queued' | 'sent' | 'skipped' | 'failed'}
 */
export type InvitationEmailDeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';
