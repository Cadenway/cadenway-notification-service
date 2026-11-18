import { describe, expect, it } from 'vitest';
import type { SecurityEmailTemplate } from '../../value-objects/security-email/security-email-template.value-object.js';
import { twoStepEmailTemplate } from './two-step-email.policy.js';

describe('twoStepEmailTemplate', () => {
  it.each<[string, SecurityEmailTemplate]>([
    ['enabled', 'two-step-enabled'],
    ['disabled', 'two-step-disabled'],
    ['authenticator-app-replaced', 'authenticator-app-replaced'],
    ['backup-codes-regenerated', 'backup-codes-regenerated'],
    ['security-key-added', 'security-key-added'],
    ['security-key-removed', 'security-key-removed'],
  ])('sends one e-mail for the change %s of the contract', (change, template) => {
    expect(twoStepEmailTemplate(change)).toBe(template);
  });

  it.each(['admin-reset', 'Enabled', '', 'constructor', '__proto__', 'toString'])(
    'has no e-mail for a change it does not know: %j',
    (change) => {
      expect(twoStepEmailTemplate(change)).toBeNull();
    },
  );
});
