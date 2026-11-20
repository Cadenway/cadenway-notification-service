import type { InboxCandidatesReader } from '../../../../ports/outbound/persistence/inbox/inbox-candidates-reader.port.js';
import type { ListInboxCandidatesInput } from './list-inbox-candidates.input.js';
import type { ListInboxCandidatesOutput } from './list-inbox-candidates.output.js';

/** Reads private candidates for Gateway's subsequent visibility check. */
export class ListInboxCandidates {
  // #region Constructor
  /** Binds a tenant-scoped reader. */
  public constructor(private readonly reader: InboxCandidatesReader) {}
  // #endregion

  // #region Methods
  /** Returns one extra candidate only to determine continuation. */
  public async execute(input: ListInboxCandidatesInput): Promise<ListInboxCandidatesOutput> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError('Invalid inbox candidate page size.');
    }
    const rows = await this.reader.pageCandidates(
      input.organizationId,
      input.recipientId,
      input.state,
      input.after,
      input.limit + 1,
    );
    const items = rows.slice(0, input.limit);
    return { items, next: rows.length > input.limit ? (items.at(-1)?.cursorAfter ?? null) : null };
  }
  // #endregion
}
