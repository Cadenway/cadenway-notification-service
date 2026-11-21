/** Distinguishes an accepted empty receipt from the two private idempotency refusals. */
export type SubmitContactOutput = 'accepted' | 'in-progress' | 'key-reused';
