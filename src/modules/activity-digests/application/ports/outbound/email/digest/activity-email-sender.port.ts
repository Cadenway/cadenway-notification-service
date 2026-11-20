import type { ActivityEmailRecipient } from '../../../../models/digest/activity-email-recipient.model.js';

/** Sends an activity email with the existing unsubscribe and suppression policies. */
export interface ActivityEmailSender {
  // #region Methods
  /** Send a generic activity notice, using a Message-ID derived from occurrenceId.
   * The asynchronous Task permit never authorizes private task content in an email. The adapter
   * must verify the deadline immediately before handing the prepared message to SMTP. If SMTP
   * accepts before the delivery result is recorded, a retry can send the same Message-ID again.
   */
  send(
    input: Readonly<{
      occurrenceId: string;
      recipient: ActivityEmailRecipient;
      count: number;
      validUntil: number;
    }>,
  ): Promise<void>;
  // #endregion
}
