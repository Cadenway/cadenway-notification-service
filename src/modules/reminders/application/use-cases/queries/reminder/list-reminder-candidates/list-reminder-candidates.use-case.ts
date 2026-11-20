import type { ReminderCandidatesReader } from '../../../../ports/outbound/persistence/reminder/reminder-candidates-reader.port.js';
import type { ListReminderCandidatesInput } from './list-reminder-candidates.input.js';
import type { ListReminderCandidatesOutput } from './list-reminder-candidates.output.js';

/** Scans the owner's pending candidate references without exposing private notes. */
export class ListReminderCandidates {
  // #region Constructor
  /** Binds the repeatable-read candidate query. */
  public constructor(private readonly reader: ReminderCandidatesReader) {}
  // #endregion

  // #region Methods
  /** Reads a bounded page at the requested generation. */
  public async execute(input: ListReminderCandidatesInput): Promise<ListReminderCandidatesOutput> {
    const page = await this.reader.page(input);
    return {
      generation: page.generation,
      hasMore: page.hasMore,
      items: page.items.map(({ snapshot }) => ({
        id: snapshot.id,
        taskId: snapshot.taskId,
        remindAt: snapshot.remindAt,
      })),
    };
  }
  // #endregion
}
