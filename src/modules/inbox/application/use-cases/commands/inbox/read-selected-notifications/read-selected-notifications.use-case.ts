import type { InboxSelectionUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-selection-unit-of-work.port.js';
import type { ReadSelectedNotificationsInput } from './read-selected-notifications.input.js';
import type { ReadSelectedNotificationsOutput } from './read-selected-notifications.output.js';

/** Marks only the authorized inbox selection through the original creation cutoff. */
export class ReadSelectedNotifications {
  // #region Constructor
  /** Binds the write transaction and its clock. */
  public constructor(
    private readonly work: InboxSelectionUnitOfWork,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Checks the scan generation and performs both counts within the same transaction. */
  public execute(input: ReadSelectedNotificationsInput): Promise<ReadSelectedNotificationsOutput> {
    return this.work.run(input.organizationId, (store) =>
      store.readAll(
        input.organizationId,
        input.recipientId,
        input.snapshotGeneration,
        input.creationCutoff,
        input.authorizedSubjects,
        this.now(),
      ),
    );
  }
  // #endregion
}
