import type { AutomationTaskNotificationAuthorizationDeniedResponse } from '@cadenway/contracts/types/internal/task-service';
import {
  AuthorizeAutomationNotificationInternalBody,
  AuthorizeAutomationNotificationInternalParams,
} from '@cadenway/contracts/validators/internal/task-service';
import {
  InternalHttpClient,
  MAX_CALL_TIMEOUT_MS,
  ProblemException,
  PROBLEM_CONTENT_TYPE,
} from '@cadenway/nest-common';
import type { InternalHttpClientOptions, InternalTokenSigner } from '@cadenway/nest-common';
import { trace } from '@opentelemetry/api';

import { readBoundedJson } from '../../../../../infrastructure/http/read-bounded-json.js';
import type { AutomationNotificationAuthority } from '../../../application/ports/outbound/tasks/inbox/automation-notification-authority.port.js';

const PRIVATE_CACHE = 'private, no-store';
const MAX_DENIAL_BYTES = 4_096;
const DENIAL = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  code: 'task.not-found',
} satisfies AutomationTaskNotificationAuthorizationDeniedResponse;

function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function isTaskDenial(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'status' in value &&
    value.status === DENIAL.status &&
    'code' in value &&
    value.code === DENIAL.code
  );
}

function privateDecisionFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    if (response.status !== 404) return response;

    const cache = response.headers.get('Cache-Control')?.trim().toLowerCase();
    const mediaType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    const signal = init?.signal;
    if (cache !== PRIVATE_CACHE || mediaType !== PROBLEM_CONTENT_TYPE || signal == null) {
      discard(response);
      throw new Error('Task did not return a private automation authorization decision.');
    }
    const denial = await readBoundedJson(response, signal, MAX_DENIAL_BYTES);
    if (!isTaskDenial(denial)) {
      throw new Error('Task did not return an automation authorization decision.');
    }
    return Response.json(DENIAL, {
      status: DENIAL.status,
      headers: { 'Content-Type': PROBLEM_CONTENT_TYPE, 'Cache-Control': PRIVATE_CACHE },
    });
  };
}

/** Requests current Task authority for each inbound command or replay. */
export function createTaskAutomationNotificationAuthority({
  baseUrl,
  signer,
  fetch: transport = globalThis.fetch,
}: Pick<InternalHttpClientOptions, 'fetch'> & {
  readonly baseUrl: string | undefined;
  readonly signer: InternalTokenSigner | undefined;
}): AutomationNotificationAuthority {
  if (baseUrl === undefined || signer === undefined) {
    return { authorize: () => Promise.resolve('unavailable') };
  }
  const client = new InternalHttpClient({
    service: 'task-service',
    baseUrl,
    signer,
    callTimeoutMs: MAX_CALL_TIMEOUT_MS,
    fetch: privateDecisionFetch(transport),
  });

  return {
    async authorize({ organizationId, taskKey, ruleAuthorUserId, recipientUserId }) {
      const params = AuthorizeAutomationNotificationInternalParams.safeParse({ taskKey });
      const command = AuthorizeAutomationNotificationInternalBody.safeParse({
        ruleAuthorUserId,
        recipientUserId,
      });
      if (!params.success || !command.success) return 'unavailable';
      const traceId = trace.getActiveSpan()?.spanContext().traceId;
      try {
        const response = await client.fetch(
          `/internal/v1/tasks/${params.data.taskKey}/automation-notification-authorization`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command.data),
            cache: 'no-store',
            claims: {
              actor: { type: 'system', id: 'notification-service' },
              organizationId,
              ...(traceId === undefined ? {} : { traceId }),
            },
            idempotent: false,
          },
        );
        const cache = response.headers.get('Cache-Control')?.trim().toLowerCase();
        if (response.status === 204 && response.body === null && cache === PRIVATE_CACHE) {
          return 'allowed';
        }
        discard(response);
        return 'unavailable';
      } catch (error: unknown) {
        return error instanceof ProblemException &&
          error.problem.status === DENIAL.status &&
          error.problem.code === DENIAL.code
          ? 'denied'
          : 'unavailable';
      }
    },
  };
}
