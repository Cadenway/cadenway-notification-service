import { decideInvitationEmail } from '../../../../../domain/policies/invitation-email/invitation-email.policy.js';
import type { InvitationEmailDecision } from '../../../../../domain/policies/invitation-email/invitation-email-decision.policy.js';
import { greetingName } from '../../../../../domain/policies/code-email/recipient-name.policy.js';
import type { InvitationEmailSkipReason } from '../../../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';
import { InvitationValidity } from '../../../../../domain/value-objects/invitation-email/invitation-validity.value-object.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { InvitationEmailQueue } from '../../../../ports/outbound/jobs/invitation-email/invitation-email-queue.port.js';
import type { InvitationEmailDeliveries } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailUnitOfWork } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-unit-of-work.port.js';
import type { RequestInvitationEmailInput } from './request-invitation-email.input.js';
import type { RequestInvitationEmailOutput } from './request-invitation-email.output.js';

/**
 * Class RequestInvitationEmail
 *
 * @description
 * Takes an issued invitation in charge, in the organization of the current context: decides
 * whether its e-mail leaves (`decideInvitationEmail`), records the delivery in the send log and,
 * when it leaves, keeps its content apart and enqueues its job, in one transaction of the
 * `InvitationEmailUnitOfWork`. A delivery of the latest version also supersedes the deliveries of
 * older versions still waiting, so a resend that arrives before the first e-mail left sends one
 * e-mail, the latest. Nothing is sent here: the job sends, outside any transaction.
 *
 * Idempotent on the event id: a redelivery that the deduplicator of the kit would not have caught
 * finds the delivery already recorded and writes nothing, so it never enqueues a second e-mail. A
 * resend is another event, with the next version, and sends again.
 */
export class RequestInvitationEmail {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of the use case.
   *
   * @type {InvitationEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: InvitationEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {InvitationEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: InvitationEmailDeliveries;

  /**
   * Property queue
   *
   * @description
   * The queue of the invitation e-mails.
   *
   * @type {InvitationEmailQueue}
   * @readonly
   */
  private readonly queue: InvitationEmailQueue;

  /**
   * Property clock
   *
   * @description
   * The current instant, to tell an expired invitation.
   *
   * @type {Clock}
   * @readonly
   */
  private readonly clock: Clock;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the ports of the use case.
   *
   * @param {InvitationEmailUnitOfWork} unitOfWork - The transaction of the use case.
   * @param {InvitationEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {InvitationEmailQueue} queue - The queue of the invitation e-mails.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: InvitationEmailUnitOfWork,
    deliveries: InvitationEmailDeliveries,
    queue: InvitationEmailQueue,
    clock: Clock,
  ) {
    this.unitOfWork = unitOfWork;
    this.deliveries = deliveries;
    this.queue = queue;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Records the e-mail of an issued invitation, and enqueues it when it is to be sent. The names
   * of the inviter and of the organization are kept as `greetingName` cleans them: they were typed
   * by people, and reach the subject and the body of the e-mail.
   *
   * @param {RequestInvitationEmailInput} input - The issued invitation.
   * @returns {Promise<RequestInvitationEmailOutput>} What became of it, once committed.
   * @throws {InvalidInvitationExpiryError} When the invitation does not expire after it was sent
   * and within 8 days, as the contract requires: the event then ends as a dead letter.
   */
  public async execute(input: RequestInvitationEmailInput): Promise<RequestInvitationEmailOutput> {
    const validity: InvitationValidity = InvitationValidity.between(
      input.issuedAt,
      input.expiresAt,
    );
    const decision: InvitationEmailDecision = decideInvitationEmail(
      input.latestVersion,
      validity,
      this.clock.now(),
    );
    const skipReason: InvitationEmailSkipReason | null =
      decision.kind === 'skip' ? decision.reason : null;

    return this.unitOfWork.run(async (): Promise<RequestInvitationEmailOutput> => {
      const deliveryId: string | null = await this.deliveries.record(
        {
          eventId: input.eventId,
          invitationId: input.invitationId,
          invitationVersion: input.version,
          role: input.role,
          language: input.language,
          validity,
          skipReason,
        },
        skipReason === null
          ? {
              recipientEmail: input.recipientEmail,
              inviterName: greetingName(input.inviterName),
              organizationName: greetingName(input.organizationName),
              memberCount: input.memberCount,
            }
          : null,
      );
      if (deliveryId === null) {
        return { outcome: 'duplicate' };
      }
      // The latest version, even expired, makes the older ones still waiting obsolete.
      const superseded: number = input.latestVersion
        ? await this.deliveries.supersede(input.invitationId, input.version)
        : 0;
      if (skipReason !== null) {
        return { outcome: 'skipped', deliveryId, reason: skipReason };
      }
      await this.queue.enqueue(deliveryId);
      return { outcome: 'queued', deliveryId, superseded };
    });
  }
  // #endregion
}
