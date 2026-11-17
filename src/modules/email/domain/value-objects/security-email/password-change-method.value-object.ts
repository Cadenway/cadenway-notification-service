/**
 * Type PasswordChangeMethod
 *
 * @description
 * How a password was changed, the `method` of `user.password-changed.v1`: `change` from a session
 * with the current password, which keeps every session; `reset` with a reset link, which closes the
 * other sessions unless the person unticked "Fermer mes autres sessions".
 *
 * @type {'change' | 'reset'}
 */
export type PasswordChangeMethod = 'change' | 'reset';
