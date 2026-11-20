import type { InboxCandidatesReader } from '../../../../ports/outbound/persistence/inbox/inbox-candidates-reader.port.js';
import type { GetInboxCandidateInput } from './get-inbox-candidate.input.js';
import type { GetInboxCandidateOutput } from './get-inbox-candidate.output.js';

/** Reads only the resource linkage of a recipient-owned notification. */
export class GetInboxCandidate {
  // #region Constructor
  /** Binds the tenant-scoped reader. */
  public constructor(private readonly reader: InboxCandidatesReader) {}
  // #endregion

  // #region Methods
  /** Leaves a missing or another recipient's record hidden. */
  public async execute(input: GetInboxCandidateInput): Promise<GetInboxCandidateOutput> {
    const candidate = await this.reader.findCandidate(
      input.organizationId,
      input.recipientId,
      input.notificationId,
    );
    return candidate === null ? null : { id: candidate.id, subject: candidate.subject };
  }
  // #endregion
}
