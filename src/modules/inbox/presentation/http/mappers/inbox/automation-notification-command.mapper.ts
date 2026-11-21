import {
  CreateAutomationNotificationInternalBody,
  CreateAutomationNotificationInternalHeader,
} from '@cadenway/contracts/validators/internal/notification-service';
import { principalOf, ProblemException } from '@cadenway/nest-common';
import type { Request } from 'express';
import { z } from 'zod';

import type { RecordAutomationNotificationInput } from '../../../../application/use-cases/commands/inbox/record-automation-notification/record-automation-notification.input.js';

/** Reads the signed rule identity and validates each input without reflecting submitted values. */
export function toAutomationNotificationCommand(
  request: Request,
): RecordAutomationNotificationInput {
  const principal = principalOf(request);
  if (principal?.issuer !== 'automation-service') {
    throw new ProblemException({ status: 403, code: 'auth.issuer-not-allowed' });
  }
  const rule = z.uuidv7().safeParse(principal.actor.id);
  if (
    principal.actor.type !== 'automation' ||
    !rule.success ||
    rule.data !== rule.data.toLowerCase()
  ) {
    throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
  }
  if (principal.organizationId === null) {
    throw new ProblemException({ status: 403, code: 'auth.organization-required' });
  }

  const key = CreateAutomationNotificationInternalHeader.safeParse({
    'Idempotency-Key': request.headers['idempotency-key'],
  });
  const keyHeaders = request.rawHeaders.filter(
    (name, index) => index % 2 === 0 && name.toLowerCase() === 'idempotency-key',
  );
  const issues: { in: 'header' | 'query' | 'body'; path: string; code: string }[] = [];
  if (
    !key.success ||
    !/^[\x21-\x7e]{1,255}$/u.test(key.data['Idempotency-Key']) ||
    keyHeaders.length !== 1
  ) {
    issues.push({ in: 'header', path: 'Idempotency-Key', code: 'invalid_format' });
  }
  if (Object.keys(request.query).length > 0) {
    issues.push({ in: 'query', path: '', code: 'unrecognized_parameter' });
  }

  const body = CreateAutomationNotificationInternalBody.safeParse(request.body);
  if (request.is('application/json') !== 'application/json') {
    issues.push({ in: 'body', path: '', code: 'invalid_type' });
  } else if (!body.success) {
    for (const issue of body.error.issues) {
      const name = issue.path[0];
      const path =
        name === 'taskKey' || name === 'ruleAuthorUserId' || name === 'recipientUserId' ? name : '';
      issues.push({ in: 'body', path, code: issue.code });
    }
  }
  if (issues.length > 0 || !key.success || !body.success) {
    throw new ProblemException({ status: 400, code: 'request.invalid', details: { issues } });
  }
  return {
    organizationId: principal.organizationId.toLowerCase(),
    taskKey: body.data.taskKey,
    ruleAuthorUserId: body.data.ruleAuthorUserId.toLowerCase(),
    recipientUserId: body.data.recipientUserId.toLowerCase(),
    ruleId: rule.data,
    commandKey: key.data['Idempotency-Key'],
  };
}
