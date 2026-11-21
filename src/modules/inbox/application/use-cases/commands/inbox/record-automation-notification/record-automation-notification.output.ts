/** The committed result recorded in the idempotency receipt. */
export interface RecordAutomationNotificationOutput {
  // #region Properties
  /** Whether the authorized action delivered an in-app notice or preferences suppressed it. */
  readonly disposition: 'applied' | 'no_op';
  // #endregion
}
