import type { PasswordChangeMethod } from '../../../domain/value-objects/security-email/password-change-method.value-object.js';
import type { ResetLinkToken } from '../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import type { SecurityEmailClient } from './security-email-client.model.js';

/**
 * Type SecurityEmailDetails
 *
 * @description
 * What a security e-mail shows besides its recipient and its date, by template, once checked and
 * cleaned. Kept with the content of the e-mail only while it is `queued`. The reset token is a
 * `ResetLinkToken`, which masks itself when it is logged or serialized. The two-step e-mails keep
 * the backup codes not used yet (`two-step-enabled`, `backup-codes-regenerated`) and the name of
 * the key added or removed, `null` when it does not look like the name of a device
 * (`shownSecurityKeyName`); that name is personal data, never logged.
 *
 * @type {{ readonly template: 'password-reset'; readonly token: ResetLinkToken; readonly client: SecurityEmailClient } | { readonly template: 'password-changed'; readonly method: PasswordChangeMethod; readonly closedSessionCount: number; readonly client: SecurityEmailClient } | { readonly template: 'email-changed'; readonly newEmail: string; readonly client: SecurityEmailClient } | { readonly template: 'new-device'; readonly client: SecurityEmailClient } | { readonly template: 'deletion-scheduled'; readonly deleteAt: Date } | { readonly template: 'deletion-cancelled'; readonly client: SecurityEmailClient } | { readonly template: 'two-step-enabled' | 'backup-codes-regenerated'; readonly backupCodesRemaining: number; readonly client: SecurityEmailClient } | { readonly template: 'two-step-disabled' | 'authenticator-app-replaced'; readonly client: SecurityEmailClient } | { readonly template: 'security-key-added' | 'security-key-removed'; readonly securityKeyName: string | null; readonly client: SecurityEmailClient }}
 */
export type SecurityEmailDetails =
  | {
      readonly template: 'password-reset';
      readonly token: ResetLinkToken;
      readonly client: SecurityEmailClient;
    }
  | {
      readonly template: 'password-changed';
      readonly method: PasswordChangeMethod;
      readonly closedSessionCount: number;
      readonly client: SecurityEmailClient;
    }
  | {
      readonly template: 'email-changed';
      readonly newEmail: string;
      readonly client: SecurityEmailClient;
    }
  | { readonly template: 'new-device'; readonly client: SecurityEmailClient }
  | { readonly template: 'deletion-scheduled'; readonly deleteAt: Date }
  | { readonly template: 'deletion-cancelled'; readonly client: SecurityEmailClient }
  | {
      readonly template: 'two-step-enabled' | 'backup-codes-regenerated';
      readonly backupCodesRemaining: number;
      readonly client: SecurityEmailClient;
    }
  | {
      readonly template: 'two-step-disabled' | 'authenticator-app-replaced';
      readonly client: SecurityEmailClient;
    }
  | {
      readonly template: 'security-key-added' | 'security-key-removed';
      readonly securityKeyName: string | null;
      readonly client: SecurityEmailClient;
    };
