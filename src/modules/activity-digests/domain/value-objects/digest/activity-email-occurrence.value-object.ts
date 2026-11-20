/** An activity email due in epoch milliseconds, planned from a current recipient profile. */
export type ActivityEmailOccurrence =
  | Readonly<{
      cadence: 'each';
      dueAtMs: number;
      profileVersion: number;
    }>
  | Readonly<{
      cadence: 'daily' | 'weekly';
      dueAtMs: number;
      /** Stable digest identity within the account and cadence, even if its due instant changes. */
      localDate: string;
      timeZone: string;
      profileVersion: number;
    }>;
