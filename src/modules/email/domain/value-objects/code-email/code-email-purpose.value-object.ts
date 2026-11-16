/**
 * Type CodeEmailPurpose
 *
 * @description
 * What a code proves, the `purpose` of `one-time-code.issued.v1`: `email-verification` confirms
 * the address of a sign-up, `sign-in` signs in without a password, `email-change` confirms a new
 * address (emitted once address changes exist).
 *
 * @type {'email-verification' | 'sign-in' | 'email-change'}
 */
export type CodeEmailPurpose = 'email-verification' | 'sign-in' | 'email-change';
