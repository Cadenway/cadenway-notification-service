/**
 * Type SecurityEmailSkipReason
 *
 * @description
 * Why a security e-mail is not sent: `expired`, its send window closed before it could leave (the
 * reset link stopped working, or a notice is more than a day old; `SendWindow`).
 *
 * @type {'expired'}
 */
export type SecurityEmailSkipReason = 'expired';
