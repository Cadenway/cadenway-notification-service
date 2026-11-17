/**
 * Type SecurityEmailTemplate
 *
 * @description
 * The security e-mails this service sends on the account events of identity-service, one per
 * event (asyncapi/identity-service.yaml of `@cadenway/contracts`):
 *
 * - `password-reset`: "Réinitialisation du mot de passe" of the Emails artboard, on
 *   `password-reset-link.issued.v1`;
 * - `password-changed`: "Mot de passe modifié", on `user.password-changed.v1`;
 * - `email-changed`: the notice to the previous address, on `user.email-changed.v1` (new copy);
 * - `new-device`: "Nouvelle connexion", on `session.opened-on-new-device.v1`;
 * - `deletion-scheduled`: "Suppression du compte", on `user.deletion-scheduled.v1`;
 * - `deletion-cancelled`: the cancellation notice, on `user.deletion-cancelled.v1` (new copy).
 *
 * @type {'password-reset' | 'password-changed' | 'email-changed' | 'new-device' | 'deletion-scheduled' | 'deletion-cancelled'}
 */
export type SecurityEmailTemplate =
  | 'password-reset'
  | 'password-changed'
  | 'email-changed'
  | 'new-device'
  | 'deletion-scheduled'
  | 'deletion-cancelled';
