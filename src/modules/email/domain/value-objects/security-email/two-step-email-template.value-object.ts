/**
 * Type TwoStepEmailTemplate
 *
 * @description
 * The security e-mails of `user.two-step-verification-changed.v1`, one per `change` of the
 * contract (`twoStepEmailTemplate`):
 *
 * - `two-step-enabled`: "Vérification en deux étapes activée" of the Emails artboard, on `enabled`;
 * - `two-step-disabled`, on `disabled` (new copy);
 * - `authenticator-app-replaced`, on the change of the same name (new copy);
 * - `backup-codes-regenerated`, on the change of the same name (new copy);
 * - `security-key-added` and `security-key-removed`, on the changes of the same names, naming the
 *   key (new copy).
 *
 * @type {'two-step-enabled' | 'two-step-disabled' | 'authenticator-app-replaced' | 'backup-codes-regenerated' | 'security-key-added' | 'security-key-removed'}
 */
export type TwoStepEmailTemplate =
  | 'two-step-enabled'
  | 'two-step-disabled'
  | 'authenticator-app-replaced'
  | 'backup-codes-regenerated'
  | 'security-key-added'
  | 'security-key-removed';
