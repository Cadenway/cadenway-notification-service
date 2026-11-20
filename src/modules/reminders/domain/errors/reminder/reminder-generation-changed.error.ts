/** The owner changed a reminder during a multi-page scan. */
export class ReminderGenerationChanged extends Error {
  // #region Constructor
  /** Exposes a stable diagnostic for the internal conflict response. */
  public constructor() {
    super('The reminder owner generation changed.');
    this.name = 'ReminderGenerationChanged';
  }
  // #endregion
}
