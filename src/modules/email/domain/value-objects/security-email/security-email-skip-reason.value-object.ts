/**
 * Type SecurityEmailSkipReason
 *
 * @description
 * Why a security e-mail is not sent: `expired`, its send window closed before it could leave (the
 * reset link stopped working, or a notice is more than a day old; `SendWindow`);
 * `change-not-supported`, the event reports a change of the two-step verification this version
 * has no e-mail for (a `change` the contract of `user.two-step-verification-changed.v1` adds
 * later), for which the contract asks a consumer to send nothing.
 *
 * @type {'expired' | 'change-not-supported'}
 */
export type SecurityEmailSkipReason = 'expired' | 'change-not-supported';
