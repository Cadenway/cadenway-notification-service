import type { PasswordChangeMethod } from '../../../domain/value-objects/security-email/password-change-method.value-object.js';
import type { SecurityEmailRequestClient } from './security-email-request-client.model.js';

/**
 * Type SecurityEmailRequest
 *
 * @description
 * What an identity-service event asks a security e-mail to say, as the handler of the event maps
 * it, by template. Raw values: the use case checks the reset token and cleans the names of the
 * device before anything is stored.
 *
 * - `password-reset`: the secret of the link (`token`) and its expiry, from
 *   `password-reset-link.issued.v1`;
 * - `password-changed`: how the password changed and how many sessions it closed;
 * - `email-changed`: the new address, the notice going to the previous one;
 * - `new-device`: the browser of the new session;
 * - `deletion-scheduled`: when the account will be deleted;
 * - `deletion-cancelled`: the browser whose sign-in cancelled the deletion.
 *
 * @type {{ readonly template: 'password-reset'; readonly token: string; readonly expiresAt: Date; readonly client: SecurityEmailRequestClient } | { readonly template: 'password-changed'; readonly method: PasswordChangeMethod; readonly closedSessionCount: number; readonly client: SecurityEmailRequestClient } | { readonly template: 'email-changed'; readonly newEmail: string; readonly client: SecurityEmailRequestClient } | { readonly template: 'new-device'; readonly client: SecurityEmailRequestClient } | { readonly template: 'deletion-scheduled'; readonly deleteAt: Date } | { readonly template: 'deletion-cancelled'; readonly client: SecurityEmailRequestClient }}
 */
export type SecurityEmailRequest =
  | {
      readonly template: 'password-reset';
      readonly token: string;
      readonly expiresAt: Date;
      readonly client: SecurityEmailRequestClient;
    }
  | {
      readonly template: 'password-changed';
      readonly method: PasswordChangeMethod;
      readonly closedSessionCount: number;
      readonly client: SecurityEmailRequestClient;
    }
  | {
      readonly template: 'email-changed';
      readonly newEmail: string;
      readonly client: SecurityEmailRequestClient;
    }
  | { readonly template: 'new-device'; readonly client: SecurityEmailRequestClient }
  | { readonly template: 'deletion-scheduled'; readonly deleteAt: Date }
  | { readonly template: 'deletion-cancelled'; readonly client: SecurityEmailRequestClient };
