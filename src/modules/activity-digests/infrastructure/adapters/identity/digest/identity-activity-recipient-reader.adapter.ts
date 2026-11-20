import {
  GetNotificationRecipientInternalParams,
  GetNotificationRecipientInternalResponse,
} from '@cadenway/contracts/validators/internal/identity-service';
import { InternalHttpClient, ProblemException } from '@cadenway/nest-common';
import type { InternalHttpClientOptions, InternalTokenClaims } from '@cadenway/nest-common';

import type { ActivityEmailRecipient } from '../../../../application/models/digest/activity-email-recipient.model.js';
import type { ActivityRecipientReader } from '../../../../application/ports/outbound/identity/digest/activity-recipient-reader.port.js';

const RECIPIENT_TIMEOUT_MS = 2_000;
const MAX_RECIPIENT_BYTES = 4_096;
const RECIPIENT = GetNotificationRecipientInternalResponse.strict();
const RECIPIENT_LOOKUP_CLAIMS: InternalTokenClaims = {
  actor: { type: 'system', id: null },
  organizationId: null,
};

/** Fails the job attempt without propagating credentials, response values or transport causes. */
function recipientUnavailable(): Error {
  return new Error('Identity could not supply the current activity email recipient.');
}

/** Checks cache policy before the shared client converts the Identity response into a problem. */
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

/** Bounds the private response even if Identity sends a slow or oversized success body. */
async function readRecipient(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw recipientUnavailable();
  const reader = response.body.getReader();
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return JSON.parse(text + decoder.decode()) as unknown;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RECIPIENT_BYTES) throw recipientUnavailable();
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error: unknown) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Creates one signed Identity client for current account email profile reads. */
export function createActivityRecipientReader({
  baseUrl,
  signer,
  fetch: transport = globalThis.fetch,
}: Pick<InternalHttpClientOptions, 'baseUrl' | 'signer' | 'fetch'>): ActivityRecipientReader {
  const client = new InternalHttpClient({
    service: 'identity-service',
    baseUrl,
    signer,
    callTimeoutMs: RECIPIENT_TIMEOUT_MS,
    fetch: privateRecipientFetch(transport),
  });

  return {
    async findCurrent(userId: string): Promise<ActivityEmailRecipient | null> {
      const params = GetNotificationRecipientInternalParams.safeParse({ userId });
      if (!params.success) throw recipientUnavailable();
      const deadline = AbortSignal.timeout(RECIPIENT_TIMEOUT_MS);
      try {
        const response = await client.fetch(
          `/internal/v1/users/${params.data.userId}/notification-recipient`,
          {
            method: 'GET',
            cache: 'no-store',
            claims: RECIPIENT_LOOKUP_CLAIMS,
            // The durable job owns retries, including the overall attempt limit.
            idempotent: false,
            signal: deadline,
          },
        );
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined);
          throw recipientUnavailable();
        }
        const profile = RECIPIENT.safeParse(await readRecipient(response, deadline));
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
