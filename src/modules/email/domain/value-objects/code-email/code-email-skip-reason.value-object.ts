/**
 * Type CodeEmailSkipReason
 *
 * @description
 * Why a code e-mail is not sent: `expired`, its code stopped working before the e-mail could
 * leave (the contract forbids sending it). Every purpose of `one-time-code.issued.v1` has its
 * template since address changes exist; the send log may still hold `purpose-not-supported` on the
 * `email-change` codes recorded before, which no version reads back.
 *
 * @type {'expired'}
 */
export type CodeEmailSkipReason = 'expired';
