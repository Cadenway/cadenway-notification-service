import type { ActivityNoticeRenderer } from '../../../../ports/outbound/templates/activity-notice/activity-notice-renderer.port.js';
import type { EmailSender } from '../../../../ports/outbound/smtp/code-email/email-sender.port.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { SendActivityNoticeInput } from './send-activity-notice.input.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

/** Renders and submits a generic notice without retaining its address or message. */
export class SendActivityNotice {
  // #region Constructor
  /** Binds the runtime renderer, SMTP sender and clock. */
  public constructor(
    private readonly renderer: ActivityNoticeRenderer,
    private readonly sender: EmailSender,
    private readonly clock: Clock,
  ) {}
  // #endregion

  // #region Methods
  /** Submits only while the current activity authorization can still be used. */
  public async execute(input: SendActivityNoticeInput): Promise<void> {
    if (!UUID.test(input.occurrenceId) || !Number.isSafeInteger(input.count) || input.count < 1) {
      throw new Error('The activity notice has an invalid occurrence or count.');
    }
    const rendered = this.renderer.renderActivityNotice(input.language, input.count);
    const now = this.clock.now().getTime();
    if (
      !Number.isSafeInteger(input.validUntil) ||
      !Number.isFinite(now) ||
      now >= input.validUntil
    ) {
      throw new Error('The activity notice authorization has expired.');
    }
    await this.sender.send({
      ...rendered,
      id: `activity-${input.occurrenceId.toLowerCase()}`,
      to: { address: input.address, name: '' },
      unsubscribe: false,
    });
  }
  // #endregion
}
