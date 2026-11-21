import { ProblemException, ProblemFilter } from '@cadenway/nest-common';
import { Catch } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';

/** Keeps automation command problems private, including guard and receipt transaction failures. */
@Catch()
export class AutomationNotificationFilter extends ProblemFilter {
  // #region Methods
  /** Preserves defined client errors and conceals dependency failures. */
  public override catch(exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    const problem =
      exception instanceof ProblemException && exception.problem.status < 500
        ? exception
        : new ProblemException({ status: 503, code: 'upstream.unavailable' });
    super.catch(problem, host);
  }
  // #endregion
}
