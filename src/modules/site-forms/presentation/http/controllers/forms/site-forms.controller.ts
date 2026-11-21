import {
  InternalAccess,
  principalOf,
  ProblemException,
  ProblemFilter,
} from '@cadenway/nest-common';
import {
  SubmitContactFormInternalBody,
  SubmitContactFormInternalHeader,
  SubscribeToNewsletterInternalBody,
} from '@cadenway/contracts/validators/internal/notification-service';
import { Catch, Controller, Header, HttpCode, Post, Req, UseFilters } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { SubmitContact } from '../../../../application/use-cases/commands/forms/submit-contact/submit-contact.use-case.js';
import { SubscribeNewsletter } from '../../../../application/use-cases/commands/forms/subscribe-newsletter/subscribe-newsletter.use-case.js';
import { InvalidSiteFormError } from '../../../../application/models/forms/invalid-site-form.model.js';

/** Ensures every controller refusal is private and keeps submitted data out of error logs. */
@Catch()
export class SiteFormsProblemFilter extends ProblemFilter {
  // #region Methods
  /** Writes a private problem without recording underlying persistence errors. */
  public override catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store');
    if (exception instanceof ProblemException && exception.getStatus() < 500) {
      super.catch(exception, host);
      return;
    }
    super.catch(new ProblemException({ status: 503, code: 'upstream.unavailable' }), host);
  }
  // #endregion
}

/** Requires the global system principal named by the published site contract. */
function requireSitePrincipal(request: Request): void {
  const principal = principalOf(request);
  if (
    principal?.issuer !== 'api-gateway' ||
    principal.actor.type !== 'system' ||
    principal.actor.id !== 'api-gateway' ||
    principal.organizationId !== null
  ) {
    throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
  }
}

/** Returns a field-only validation problem without retaining submitted values. */
function invalid(field: string, location: 'body' | 'header' | 'query'): never {
  throw new ProblemException({
    status: 400,
    code: 'request.invalid',
    details: { issues: [{ in: location, path: field, code: 'invalid_format' }] },
  });
}

/** Reports only paths belonging to the published body schema. */
function invalidBody(issues: readonly z.core.$ZodIssue[], fields: readonly string[]): never {
  throw new ProblemException({
    status: 400,
    code: 'request.invalid',
    details: {
      issues: issues.map((issue) => {
        const [path] = issue.path;
        return {
          in: 'body',
          path: typeof path === 'string' && fields.includes(path) ? path : '',
          code: issue.code,
        };
      }),
    },
  });
}

/** Receives account-free contact and newsletter submissions from the gateway. */
@Controller('internal/v1')
@InternalAccess({ issuers: ['api-gateway'], actors: ['system'], organization: 'optional' })
@UseFilters(SiteFormsProblemFilter)
export class SiteFormsController {
  // #region Constructor
  /** Uses the two form submission commands. */
  public constructor(
    private readonly contact: SubmitContact,
    private readonly newsletter: SubscribeNewsletter,
  ) {}
  // #endregion

  // #region Methods
  /** Records a contact message and its delivery intent. */
  @Post('contact-submissions')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  public async submitContact(@Req() request: Request): Promise<void> {
    requireSitePrincipal(request);
    if (Object.keys(request.query).length !== 0) invalid('', 'query');
    if (request.is('application/json') !== 'application/json') invalid('', 'body');
    const header = SubmitContactFormInternalHeader.safeParse({
      'Idempotency-Key': request.headers['idempotency-key'],
    });
    const keyCount = request.rawHeaders.filter(
      (_value, index) =>
        index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === 'idempotency-key',
    ).length;
    if (!header.success || keyCount !== 1) invalid('Idempotency-Key', 'header');
    const body = SubmitContactFormInternalBody.safeParse(request.body);
    if (!body.success)
      invalidBody(body.error.issues, SubmitContactFormInternalBody.keyof().options);
    try {
      const result = await this.contact.execute({
        ...body.data,
        idempotencyKey: header.data['Idempotency-Key'],
      });
      if (result === 'in-progress') {
        throw new ProblemException({ status: 409, code: 'idempotency.request-in-progress' });
      }
      if (result === 'key-reused') {
        throw new ProblemException({ status: 422, code: 'idempotency.key-reused' });
      }
    } catch (error) {
      if (error instanceof InvalidSiteFormError) invalid(error.field, 'body');
      throw error;
    }
  }

  /** Records a newsletter address and returns the same receipt for existing subscribers. */
  @Post('newsletter-subscriptions')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  public async subscribe(@Req() request: Request): Promise<void> {
    requireSitePrincipal(request);
    if (Object.keys(request.query).length !== 0) invalid('', 'query');
    if (request.is('application/json') !== 'application/json') invalid('', 'body');
    const body = SubscribeToNewsletterInternalBody.safeParse(request.body);
    if (!body.success)
      invalidBody(body.error.issues, SubscribeToNewsletterInternalBody.keyof().options);
    try {
      await this.newsletter.execute(body.data);
    } catch (error) {
      if (error instanceof InvalidSiteFormError) invalid(error.field, 'body');
      throw error;
    }
  }
  // #endregion
}
