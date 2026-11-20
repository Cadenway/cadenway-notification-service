import { ProblemException } from '@cadenway/nest-common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';

const networkCodes: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
]);
const postgresCodes: ReadonlySet<string> = new Set(['53300', '57P01', '57P02', '57P03', '58030']);

/** Maps recognized database availability failures to the documented owner-state problem. */
export class OwnerStateUnavailableInterceptor implements NestInterceptor {
  // #region Methods
  /** Preserves other errors for their ordinary domain or unexpected-error handling. */
  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      catchError((error: unknown) => {
        let cause: unknown = error;
        const visited = new Set<Error>();
        while (cause instanceof Error && !visited.has(cause)) {
          visited.add(cause);
          const code: unknown = Reflect.get(cause, 'code');
          if (
            typeof code === 'string' &&
            (networkCodes.has(code) || postgresCodes.has(code) || /^08[0-9A-Z]{3}$/u.test(code))
          ) {
            return throwError(
              () =>
                new ProblemException({
                  status: 503,
                  code: 'upstream.unavailable',
                  detail: 'The owner state is temporarily unavailable.',
                }),
            );
          }
          cause = cause.cause;
        }
        return throwError(() => error);
      }),
    );
  }
  // #endregion
}
