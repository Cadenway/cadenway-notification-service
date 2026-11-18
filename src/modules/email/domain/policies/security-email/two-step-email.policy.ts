import type { TwoStepEmailTemplate } from '../../value-objects/security-email/two-step-email-template.value-object.js';

/**
 * Constant TWO_STEP_TEMPLATES
 *
 * @description
 * The template of each `change` of `user.two-step-verification-changed.v1` this version knows. A
 * map, so that no key of `Object.prototype` reads as a change.
 *
 * @type {ReadonlyMap<string, TwoStepEmailTemplate>}
 */
const TWO_STEP_TEMPLATES: ReadonlyMap<string, TwoStepEmailTemplate> = new Map<
  string,
  TwoStepEmailTemplate
>([
  ['enabled', 'two-step-enabled'],
  ['disabled', 'two-step-disabled'],
  ['authenticator-app-replaced', 'authenticator-app-replaced'],
  ['backup-codes-regenerated', 'backup-codes-regenerated'],
  ['security-key-added', 'security-key-added'],
  ['security-key-removed', 'security-key-removed'],
]);

/**
 * Function twoStepEmailTemplate
 *
 * @description
 * The security e-mail a change of the two-step verification of an account asks for: one per
 * `change` of `user.two-step-verification-changed.v1` (asyncapi/identity-service.yaml of
 * `@cadenway/contracts` 0.8.0), `enabled` being the "Vérification en deux étapes activée" of the
 * Emails artboard and the others new copy. The contract lets later versions add values without a
 * new event version (an administrator's reset, for example) and asks a consumer to send no e-mail
 * for a value it does not know: such a change has no template.
 *
 * @param {string} change - `change` of the event.
 * @returns {TwoStepEmailTemplate | null} The template, or `null` for a change this version does
 * not know.
 */
export function twoStepEmailTemplate(change: string): TwoStepEmailTemplate | null {
  return TWO_STEP_TEMPLATES.get(change) ?? null;
}
