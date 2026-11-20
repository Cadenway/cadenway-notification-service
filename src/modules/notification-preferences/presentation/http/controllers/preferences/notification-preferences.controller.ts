import {
  formatEtag,
  IfMatch,
  InternalAccess,
  principalOf,
  ProblemException,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import type { IfMatchCondition } from '@cadenway/nest-common';
import type {
  NotificationPreferences,
  NotificationPreferencesPatch,
} from '@cadenway/contracts/types/internal/notification-service';
import { UpdateNotificationPreferencesInternalBody } from '@cadenway/contracts/validators/internal/notification-service';
import { Body, Controller, Get, Patch, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { PreferencesVersionMismatch } from '../../../../application/models/preferences/preferences-version-mismatch.model.js';
import { UpdateNotificationPreferences } from '../../../../application/use-cases/commands/preferences/update-notification-preferences/update-notification-preferences.use-case.js';
import { GetNotificationPreferences } from '../../../../application/use-cases/queries/preferences/get-notification-preferences/get-notification-preferences.use-case.js';
import type { GetNotificationPreferencesOutput } from '../../../../application/use-cases/queries/preferences/get-notification-preferences/get-notification-preferences.output.js';

/** Returns only the preferences fields in the published HTTP contract. */
function representation(snapshot: GetNotificationPreferencesOutput): NotificationPreferences {
  return {
    channels: snapshot.channels,
    digest: snapshot.digest,
    doNotDisturb: snapshot.doNotDisturb,
    version: snapshot.version,
  };
}

/** Resolves the account from the principal already verified by the internal-token guard. */
function accountId(request: Request): string {
  const principal = principalOf(request);
  if (principal?.actor.type !== 'user' || principal.actor.id === null) {
    throw new ProblemException({
      status: 401,
      code: 'auth.token-invalid',
      detail: 'The account identity is unavailable.',
    });
  }
  return principal.actor.id;
}

/** Account-global notification settings for the authenticated gateway user. */
@Controller('internal/v1/me/notification-preferences')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'], organization: 'optional' })
export class NotificationPreferencesController {
  // #region Constructor
  /** Binds reads and atomic updates to their application use cases. */
  public constructor(
    private readonly getPreferences: GetNotificationPreferences,
    private readonly updatePreferences: UpdateNotificationPreferences,
  ) {}
  // #endregion

  // #region Methods
  /** Reads the caller's settings including version-one defaults. */
  @Get()
  public async get(@Req() request: Request): Promise<NotificationPreferences> {
    const result = representation(
      await this.getPreferences.execute({ userId: accountId(request) }),
    );
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return result;
  }

  /** Applies a partial settings update with an optional version precondition. */
  @Patch()
  public async update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @IfMatch() condition: IfMatchCondition,
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesInternalBody))
    patch: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences> {
    try {
      return representation(
        await this.updatePreferences.execute({
          userId: accountId(request),
          patch,
          expectedVersions: condition,
        }),
      );
    } catch (error) {
      if (!(error instanceof PreferencesVersionMismatch)) throw error;
      response.setHeader('ETag', formatEtag(error.currentVersion));
      throw new ProblemException({
        status: 412,
        code: 'request.version-mismatch',
        detail: 'The preferences changed since they were read.',
        details: { version: error.currentVersion },
      });
    }
  }
  // #endregion
}
