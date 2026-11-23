import type { StageTaskNotificationFactInput } from '../../../../use-cases/commands/inbox/stage-task-notification-fact/stage-task-notification-fact.input.js';

/** Hands the same trusted Task events to the independent activity email capability. */
export interface InboxActivityDelivery {
  // #region Methods
  /** Records the redacted source audience durably for the independently retried email worker. */
  enqueue(input: Omit<StageTaskNotificationFactInput, 'expiresAt'>): Promise<void>;
  // #endregion
}
