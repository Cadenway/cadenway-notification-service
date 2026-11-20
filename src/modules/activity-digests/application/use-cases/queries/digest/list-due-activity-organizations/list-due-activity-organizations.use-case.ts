import type { ActivityDueOrganizationsReader } from '../../../../ports/outbound/persistence/digest/activity-due-organizations-reader.port.js';
import type { SendActivityEmailInput } from '../../../commands/digest/send-activity-email/send-activity-email.input.js';

/** Finds the tenant boundaries of one bounded account-wide delivery. */
export class ListDueActivityOrganizations {
  // #region Constructor
  /** Binds the bounded due occurrence reader. */
  public constructor(private readonly reader: ActivityDueOrganizationsReader) {}
  // #endregion

  // #region Methods
  /** Returns no organizations when this job's occurrence is no longer scheduled and due. */
  public execute(input: SendActivityEmailInput): Promise<readonly string[]> {
    return this.reader.listDueOrganizations(input.userId, input.occurrenceId, input.generation);
  }
  // #endregion
}
