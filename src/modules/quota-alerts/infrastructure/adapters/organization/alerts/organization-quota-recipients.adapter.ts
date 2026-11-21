import {
  ListQuotaNotificationRecipientsInternalQueryParams,
  ListQuotaNotificationRecipientsInternalResponse,
  LookupQuotaNotificationRecipientsInternalBody,
  LookupQuotaNotificationRecipientsInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import { InternalHttpClient, ProblemException } from '@cadenway/nest-common';
import type { InternalHttpClientOptions } from '@cadenway/nest-common';

import { readBoundedJson } from '../../../../../../infrastructure/http/read-bounded-json.js';
import type { QuotaRecipients } from '../../../../application/ports/outbound/organization/alerts/quota-recipients.port.js';

const PAGE_SIZE = 100;
const TIMEOUT_MS = 2_000;
const MAX_BODY_BYTES = 8_192;
const ROUTE = '/internal/v1/quota-notification-recipients';

/** Produces only private, bounded lookups and defers the job on unavailable authority. */
export function createOrganizationQuotaRecipients({
  baseUrl,
  signer,
  fetch: transport = globalThis.fetch,
}: Pick<InternalHttpClientOptions, 'baseUrl' | 'signer' | 'fetch'>): QuotaRecipients {
  const unavailable = (): Error =>
    new Error('Organization could not supply the current quota notification authority.');
  const client = new InternalHttpClient({
    service: 'organization-service',
    baseUrl,
    signer,
    callTimeoutMs: TIMEOUT_MS,
    fetch: async (input, init) => {
      const response = await transport(input, init);
      const cache = response.headers.get('Cache-Control')?.trim().toLowerCase();
      const mediaType = response.headers
        .get('Content-Type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        cache !== 'private, no-store' ||
        (response.status === 200 && mediaType !== 'application/json') ||
        (response.status === 404 && mediaType !== 'application/problem+json')
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw unavailable();
      }
      return response;
    },
  });

  async function fetchCurrent(
    organizationId: string,
    path: string,
    input: { readonly method: 'GET' } | { readonly method: 'POST'; readonly body: string },
    signal: AbortSignal,
  ): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
    try {
      const response = await client.fetch(path, {
        ...input,
        ...(input.method === 'POST' ? { headers: { 'Content-Type': 'application/json' } } : {}),
        cache: 'no-store',
        claims: {
          actor: { type: 'system', id: 'notification-service' },
          organizationId,
        },
        idempotent: false,
        signal: deadline,
      });
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        throw unavailable();
      }
      return await readBoundedJson(response, deadline, MAX_BODY_BYTES);
    } catch (error: unknown) {
      if (
        error instanceof ProblemException &&
        error.problem.status === 404 &&
        error.problem.code === 'organization.not-found'
      ) {
        return null;
      }
      throw unavailable();
    }
  }

  return {
    async list(organizationId, cursor, signal) {
      const query = ListQuotaNotificationRecipientsInternalQueryParams.safeParse({
        limit: PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
      });
      if (!query.success) throw unavailable();
      const params = new URLSearchParams({ limit: String(query.data.limit) });
      if (query.data.cursor !== undefined) params.set('cursor', query.data.cursor);
      const body = await fetchCurrent(
        organizationId,
        `${ROUTE}?${params}`,
        { method: 'GET' },
        signal,
      );
      if (body === null) return { items: [], nextCursor: null };
      const page = ListQuotaNotificationRecipientsInternalResponse.strict().safeParse(body);
      if (!page.success) throw unavailable();
      return page.data;
    },

    async isEligible(organizationId, userId, signal) {
      const lookup = LookupQuotaNotificationRecipientsInternalBody.safeParse({ userIds: [userId] });
      if (!lookup.success) throw unavailable();
      const body = await fetchCurrent(
        organizationId,
        `${ROUTE}/lookup`,
        { method: 'POST', body: JSON.stringify(lookup.data) },
        signal,
      );
      if (body === null) return false;
      const page = LookupQuotaNotificationRecipientsInternalResponse.strict().safeParse(body);
      if (!page.success) throw unavailable();
      return page.data.items.some((eligible) => eligible.toLowerCase() === userId.toLowerCase());
    },
  };
}
