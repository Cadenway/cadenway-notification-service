import { generateKeyPairSync } from 'node:crypto';

import type { Ed25519PrivateJwk } from '@cadenway/nest-common';

/** Generates an in-memory key used only to sign synthetic Notification test requests. */
export function notificationIdentityTestKey(): Ed25519PrivateJwk {
  const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (x === undefined || d === undefined) throw new Error('Expected an Ed25519 fixture key.');
  return { kty: 'OKP', crv: 'Ed25519', kid: 'notification-identity-test', x, d };
}
