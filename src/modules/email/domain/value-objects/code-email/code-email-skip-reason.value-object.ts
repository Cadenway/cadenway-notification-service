/**
 * Type CodeEmailSkipReason
 *
 * @description
 * Why a code e-mail is not sent: `expired`, its code stopped working before the e-mail could
 * leave (the contract forbids sending it); `purpose-not-supported`, no template exists for its
 * purpose yet (`email-change`, a later phase).
 *
 * @type {'expired' | 'purpose-not-supported'}
 */
export type CodeEmailSkipReason = 'expired' | 'purpose-not-supported';
