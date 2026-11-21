import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { InvalidSiteFormError } from '../../errors/forms/invalid-site-form.error.js';
import { PublicSiteMailbox } from './public-site-mailbox.value-object.js';

describe('PublicSiteMailbox', () => {
  it('preserves the submitted address for Reply-To and lowercases only the subscription domain', () => {
    const mailbox = PublicSiteMailbox.of('Camille.Martin+actu@AtelierNord.FR');

    expect(mailbox.address()).toBe('Camille.Martin+actu@AtelierNord.FR');
    expect(mailbox.subscriptionIdentity()).toBe('Camille.Martin+actu@ateliernord.fr');
    expect(PublicSiteMailbox.of('Camille.Martin+actu@ateliernord.fr').subscriptionIdentity()).toBe(
      mailbox.subscriptionIdentity(),
    );
    expect(
      PublicSiteMailbox.of('camille.martin+actu@ateliernord.fr').subscriptionIdentity(),
    ).not.toBe(mailbox.subscriptionIdentity());
    expect(PublicSiteMailbox.of('Camille.Martin@ateliernord.fr').subscriptionIdentity()).not.toBe(
      mailbox.subscriptionIdentity(),
    );
  });

  it('accepts a single mailbox at the 254 character limit', () => {
    const address = `${'a'.repeat(243)}@example.fr`;

    expect(PublicSiteMailbox.of(address).address()).toBe(address);
    expect(() => PublicSiteMailbox.of(`a${address}`)).toThrow(InvalidSiteFormError);
  });

  it.each([
    ' camille@example.fr',
    'camille@example.fr ',
    'camille@example.fr\r\nCc: someone@example.fr',
    'Camille <camille@example.fr>',
    'camille@example.fr,other@example.fr',
    'camille@@example.fr',
    'camille..martin@example.fr',
    'camille.example.fr',
    'camille@',
    '',
  ])('refuses malformed addresses with a typed field error', (address) => {
    expect(() => PublicSiteMailbox.of(address)).toThrow(
      expect.objectContaining({ name: 'InvalidSiteFormError', field: 'email' }),
    );
  });

  it('keeps the address out of implicit inspection and serialization', () => {
    const address = 'camille@example.fr';
    const mailbox = PublicSiteMailbox.of(address);

    expect(JSON.stringify(mailbox)).toBe('{}');
    expect(inspect(mailbox)).not.toContain(address);
  });
});
