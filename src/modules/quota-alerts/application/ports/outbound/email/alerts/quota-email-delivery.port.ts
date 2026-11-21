import type { QuotaAlert } from '../../../../models/alerts/quota-alert.model.js';

/** Existing preference, recipient profile and email capabilities used by quota workers. */
export interface QuotaEmailDelivery {
  // #region Methods
  /** Reads the account's current Billing email preference. */
  isEnabled(userId: string): Promise<boolean>;

  /** Resolves the current verified address through Identity. */
  resolve(userId: string, signal: AbortSignal): Promise<string | null>;

  /** Hands the authorized message to Email with a stable occurrence identifier. */
  send(occurrenceId: string, address: string, alert: QuotaAlert): Promise<void>;
  // #endregion
}
