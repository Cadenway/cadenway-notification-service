import type { InboxCandidatesReader } from '../../../../ports/outbound/persistence/inbox/inbox-candidates-reader.port.js';
import type { ListUnreadSubjectsInput } from './list-unread-subjects.input.js';
import type { ListUnreadSubjectsOutput } from './list-unread-subjects.output.js';

/** Scans exact unread subjects at one owner generation. */
export class ListUnreadSubjects {
  // #region Constructor
  /** Binds a tenant-scoped snapshot reader. */
  public constructor(private readonly reader: InboxCandidatesReader) {}
  // #endregion

  // #region Methods
  /** Propagates a generation conflict so Gateway can rescan. */
  public execute(input: ListUnreadSubjectsInput): Promise<ListUnreadSubjectsOutput> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError('Invalid inbox subject page size.');
    }
    return this.reader.unreadSubjects(
      input.organizationId,
      input.recipientId,
      input.expectedGeneration,
      input.after,
      input.limit,
    );
  }
  // #endregion
}
