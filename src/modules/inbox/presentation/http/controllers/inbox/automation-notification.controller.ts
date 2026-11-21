import type { AutomationNotificationReceipt } from '@cadenway/contracts/types/internal/notification-service';
import { CreateAutomationNotificationInternalResponse } from '@cadenway/contracts/validators/internal/notification-service';
import { InternalAccess } from '@cadenway/nest-common';
import { Controller, Header, HttpCode, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { RecordAutomationNotification } from '../../../../application/use-cases/commands/inbox/record-automation-notification/record-automation-notification.use-case.js';
import { AutomationNotificationFilter } from '../../errors/inbox/automation-notification.filter.js';
import { AutomationNotificationAccessGuard } from '../../guards/inbox/automation-notification-access.guard.js';
import { toAutomationNotificationCommand } from '../../mappers/inbox/automation-notification-command.mapper.js';

/** Accepts task-linked inbox notices from signed automation rules. */
@Controller('internal/v1/inbox')
@InternalAccess({
  issuers: ['automation-service'],
  actors: ['automation'],
  organization: 'required',
})
@UseGuards(AutomationNotificationAccessGuard)
@UseFilters(AutomationNotificationFilter)
export class AutomationNotificationController {
  // #region Constructor
  /** Binds the recipient's transactional inbox command. */
  public constructor(private readonly record: RecordAutomationNotification) {}
  // #endregion

  // #region Methods
  /** Records a verified automation command and returns its private receipt. */
  @Post('automation-notifications')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async create(@Req() request: Request): Promise<AutomationNotificationReceipt> {
    const receipt = await this.record.execute(toAutomationNotificationCommand(request));
    return CreateAutomationNotificationInternalResponse.parse(receipt);
  }
  // #endregion
}
