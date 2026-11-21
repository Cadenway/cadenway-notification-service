import { ProblemException } from '@cadenway/nest-common';
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AuthorizeAutomationNotification } from '../../../../application/use-cases/queries/inbox/authorize-automation-notification/authorize-automation-notification.use-case.js';
import { toAutomationNotificationCommand } from '../../mappers/inbox/automation-notification-command.mapper.js';

/** Requires fresh Task authorization before Nest can enter the idempotency interceptor. */
@Injectable()
export class AutomationNotificationAccessGuard implements CanActivate {
  // #region Constructor
  /** Binds the current Task access query. */
  public constructor(private readonly authority: AuthorizeAutomationNotification) {}
  // #endregion

  // #region Methods
  /** Checks both accounts against the same live task for this command. */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { organizationId, taskKey, ruleAuthorUserId, recipientUserId } =
      toAutomationNotificationCommand(request);
    const decision = await this.authority.execute({
      organizationId,
      taskKey,
      ruleAuthorUserId,
      recipientUserId,
    });
    if (decision === 'allowed') return true;
    if (decision === 'denied') {
      throw new ProblemException({ status: 404, code: 'notification.not-found' });
    }
    throw new ProblemException({ status: 503, code: 'upstream.unavailable' });
  }
  // #endregion
}
