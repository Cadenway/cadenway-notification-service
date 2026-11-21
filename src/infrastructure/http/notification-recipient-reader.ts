import {
  GetNotificationRecipientInternalParams,
  GetNotificationRecipientInternalResponse,
} from '@cadenway/contracts/validators/internal/identity-service';
import { InternalHttpClient, ProblemException } from '@cadenway/nest-common';
import type { InternalHttpClientOptions, InternalTokenClaims } from '@cadenway/nest-common';
import type { output } from 'zod';

import { readBoundedJson } from './read-bounded-json.js';

const RECIPIENT_TIMEOUT_MS = 2_000;
const MAX_RECIPIENT_BYTES = 4_096;
const RECIPIENT = GetNotificationRecipientInternalResponse.strict();
const RECIPIENT_LOOKUP_CLAIMS: InternalTokenClaims = {
  actor: { type: 'system', id: null },
  organizationId: null,
};

/** Fails the job without propagating credentials, response values or transport causes. */
function recipientUnavailable(): Error {
  return new Error('Identity could not supply the current activity email recipient.');
}

function privateRecipientFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    const cacheControl = response.headers.get('Cache-Control')?.trim().toLowerCase();
    const mediaType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (
      cacheControl !== 'no-store' ||
      (response.status === 200 && mediaType !== 'application/json') ||
      (response.status === 404 && mediaType !== 'application/problem+json')
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw recipientUnavailable();
    }
    return response;
  };
}

/** Creates the signed Identity client shared by Notification's email deliveries. */
export function createNotificationRecipientReader({
  baseUrl,
  signer,
  fetch: transport = globalThis.fetch,
}: Pick<InternalHttpClientOptions, 'baseUrl' | 'signer' | 'fetch'>): {
  readonly findCurrent: (
    userId: string,
    signal?: AbortSignal,
  ) => Promise<(output<typeof RECIPIENT> & { readonly userId: string }) | null>;
} {
  const client = new InternalHttpClient({
    service: 'identity-service',
    baseUrl,
    signer,
    callTimeoutMs: RECIPIENT_TIMEOUT_MS,
    fetch: privateRecipientFetch(transport),
  });

  return {
    async findCurrent(userId, signal) {
      const params = GetNotificationRecipientInternalParams.safeParse({ userId });
      if (!params.success) throw recipientUnavailable();
      const timeout = AbortSignal.timeout(RECIPIENT_TIMEOUT_MS);
      const deadline = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
      try {
        const response = await client.fetch(
          `/internal/v1/users/${params.data.userId}/notification-recipient`,
          {
            method: 'GET',
            cache: 'no-store',
            claims: RECIPIENT_LOOKUP_CLAIMS,
            idempotent: false,
            signal: deadline,
          },
        );
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined);
          throw recipientUnavailable();
        }
        const profile = RECIPIENT.safeParse(
          await readBoundedJson(response, deadline, MAX_RECIPIENT_BYTES),
        );
        if (!profile.success) throw recipientUnavailable();
        return { userId: params.data.userId, ...profile.data };
      } catch (error: unknown) {
        if (
          error instanceof ProblemException &&
          error.problem.status === 404 &&
          error.problem.code === 'user.not-found'
        ) {
          return null;
        }
        throw recipientUnavailable();
      }
    },
  };
}
