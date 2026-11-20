import { ReminderError } from '../../errors/reminder/reminder.error.js';
import type { ReminderDue } from '../../events/reminder/reminder-due.event.js';
import type { ReminderSnapshot } from '../../value-objects/reminder/reminder-snapshot.value-object.js';

type NewReminder = Pick<
  ReminderSnapshot,
  'id' | 'organizationId' | 'userId' | 'taskId' | 'remindAt' | 'note'
>;

/** The personal task reminder lifecycle from the task mockup and P4 Reminders contract. */
export class Reminder {
  // #region Properties
  /** Immutable persisted state. Authorize before projecting the private note to a caller. */
  public readonly snapshot: ReminderSnapshot;

  /** A reminder stays pending after firing and releases its task slot on completion. */
  public get isPending(): boolean {
    return this.snapshot.completedAt === null;
  }
  // #endregion

  // #region Constructor
  /** Accepts only a valid lifecycle state and owns its immutable copy. */
  private constructor(snapshot: ReminderSnapshot) {
    validate(snapshot);
    this.snapshot = Object.freeze({ ...snapshot });
  }
  // #endregion

  // #region Methods
  /** Schedules a new future reminder. The application allocates the per-task slot atomically. */
  public static schedule(input: NewReminder, now: number): Reminder {
    requireFuture(input.remindAt, now);
    return new Reminder({
      ...input,
      createdAt: now,
      firedAt: null,
      completedAt: null,
      version: 1,
      scheduleVersion: 1,
    });
  }

  /** Reconstitutes a reminder already assigned to the caller or its recorded owner. */
  public static restore(snapshot: ReminderSnapshot): Reminder {
    return new Reminder(snapshot);
  }

  /** Conceals missing ownership and unreadable task links behind the same refusal. */
  public requireAccess(organizationId: string, userId: string, taskVisible: boolean): void {
    if (
      organizationId !== this.snapshot.organizationId ||
      userId !== this.snapshot.userId ||
      !taskVisible
    ) {
      throw new ReminderError('reminder.not-found');
    }
  }

  /**
   * Updates an occupied task slot. Only a changed instant replaces its job and clears firing.
   * An exact replay works even after the scheduled instant has passed.
   */
  public setSchedule(remindAt: number, note: string | null, now: number): Reminder {
    this.requirePending();
    if (remindAt === this.snapshot.remindAt) {
      return this.changeNote(note);
    }
    requireFuture(remindAt, now);
    const version = this.snapshot.version + 1;
    return new Reminder({
      ...this.snapshot,
      remindAt,
      note,
      firedAt: null,
      version,
      scheduleVersion: version,
    });
  }

  /** Postpones a pending reminder and preserves its note. */
  public snooze(remindAt: number, now: number): Reminder {
    return this.setSchedule(remindAt, this.snapshot.note, now);
  }

  /** Edits a private note without invalidating the active schedule. */
  public changeNote(note: string | null): Reminder {
    this.requirePending();
    if (note === this.snapshot.note) return this;
    return new Reminder({ ...this.snapshot, note, version: this.snapshot.version + 1 });
  }

  /** Releases the active slot on the first completion and leaves a repeated completion unchanged. */
  public complete(now: number): Reminder {
    if (!this.isPending) return this;
    return new Reminder({
      ...this.snapshot,
      completedAt: now,
      version: this.snapshot.version + 1,
    });
  }

  /**
   * Marks the current due schedule fired once, after the worker confirms the task is still
   * visible. A stale, early, already-fired or completed job carries no new fact.
   */
  public fireIfDue(
    scheduleVersion: number,
    now: number,
  ): { readonly reminder: Reminder; readonly fact: ReminderDue | null } {
    const { id, organizationId, userId, taskId, remindAt, version, firedAt } = this.snapshot;
    if (
      !this.isPending ||
      scheduleVersion !== this.snapshot.scheduleVersion ||
      firedAt !== null ||
      now < remindAt
    ) {
      return { reminder: this, fact: null };
    }
    return {
      reminder: new Reminder({ ...this.snapshot, firedAt: now, version: version + 1 }),
      fact: {
        reminderId: id,
        organizationId,
        userId,
        taskId,
        remindAt,
        firedAt: now,
        version: version + 1,
      },
    };
  }

  /** Refuses note and schedule changes after completion. */
  private requirePending(): void {
    if (!this.isPending) throw new ReminderError('reminder.already-completed');
  }
  // #endregion
}

/** Validates representation constraints of a persisted reminder. */
function validate(snapshot: ReminderSnapshot): void {
  const { id, organizationId, userId, taskId, version, scheduleVersion } = snapshot;
  const { createdAt, remindAt, note, firedAt, completedAt } = snapshot;
  if (
    [id, organizationId, userId, taskId].some((value) => value.trim() === '') ||
    !Number.isSafeInteger(version) ||
    !Number.isSafeInteger(scheduleVersion) ||
    scheduleVersion < 1 ||
    version < scheduleVersion ||
    !isInstant(createdAt) ||
    !isInstant(remindAt) ||
    remindAt <= createdAt ||
    (firedAt !== null && (!isInstant(firedAt) || firedAt < remindAt)) ||
    (completedAt !== null && (!isInstant(completedAt) || completedAt < (firedAt ?? createdAt))) ||
    (note !== null && Array.from(note).length > 500)
  ) {
    throw new ReminderError('invalid-reminder');
  }
}

/** Applies the Reminders contract's strict future date rule to new or changed instants only. */
function requireFuture(remindAt: number, now: number): void {
  if (!isInstant(remindAt) || !isInstant(now)) throw new ReminderError('invalid-reminder');
  if (remindAt <= now) throw new ReminderError('reminder.date-not-in-future');
}

/** Identifies an integral timestamp inside the runtime's UTC date range. */
function isInstant(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000;
}
