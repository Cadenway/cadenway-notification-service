/** Reads only tenant identifiers of one due, account-bound activity occurrence. */
export interface ActivityDueOrganizationsReader {
  // #region Methods
  /** Lists the bounded tenant fan-out, empty for an occurrence no longer due. */
  listDueOrganizations(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<readonly string[]>;
  // #endregion
}
