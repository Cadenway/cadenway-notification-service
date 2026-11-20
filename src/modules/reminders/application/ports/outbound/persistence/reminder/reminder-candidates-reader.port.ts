import type { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';

/** Reads owner-scoped candidates within a read-only repeatable-read tenant snapshot. */
export interface ReminderCandidatesReader {
  // #region Methods
  /** Reads one ordered page with the generation observed in the same snapshot. */
  page(input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly expectedGeneration: string | null;
    readonly after: { readonly remindAt: number; readonly id: string } | null;
    readonly limit: number;
  }): Promise<{
    readonly generation: string;
    readonly items: readonly Reminder[];
    readonly hasMore: boolean;
  }>;

  /** Verifies the generation and returns exact owner and task matches in input order. */
  selected(input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly expectedGeneration: string;
    readonly pairs: readonly { readonly id: string; readonly taskId: string }[];
  }): Promise<readonly Reminder[]>;
  // #endregion
}
