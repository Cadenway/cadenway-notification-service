import { NotificationPreferencesError } from '../../errors/preferences/notification-preferences.error.js';
import type { NotificationPreferencesPatch } from '../../value-objects/preferences/notification-preferences-patch.value-object.js';
import type { NotificationPreferencesSnapshot } from '../../value-objects/preferences/notification-preferences-snapshot.value-object.js';

type Channels = NotificationPreferencesSnapshot['channels'];
type Category = keyof Channels;
type ChannelSettings = Channels[Category];
type Digest = NotificationPreferencesSnapshot['digest'];

const categories: readonly Category[] = [
  'mention',
  'assignment',
  'comment',
  'statusChange',
  'dueDate',
  'access',
  'billing',
];

const digests: readonly Digest[] = ['each', 'daily', 'weekly', 'never'];

/** Account preferences and partial update semantics from the P4 Inbox contract. */
export class NotificationPreferences {
  // #region Properties
  /** The immutable preferences. The owning account has no organization scope here. */
  public readonly snapshot: NotificationPreferencesSnapshot;
  // #endregion

  // #region Constructor
  /** Validates every saved flag and the cadence before exposing the state. */
  private constructor(snapshot: NotificationPreferencesSnapshot) {
    if (
      snapshot.userId.trim() === '' ||
      !digests.includes(snapshot.digest) ||
      typeof snapshot.doNotDisturb !== 'boolean' ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version < 1
    ) {
      throw new NotificationPreferencesError();
    }
    this.snapshot = Object.freeze({ ...snapshot, channels: ownChannels(snapshot.channels) });
  }
  // #endregion

  // #region Methods
  /** Returns the version-one defaults shown by the Compte › Notifications mockup. */
  public static defaults(userId: string): NotificationPreferences {
    const all: ChannelSettings = { inApp: true, email: true, mobile: true };
    const inboxOnly: ChannelSettings = { inApp: true, email: false, mobile: false };
    const inboxAndEmail: ChannelSettings = { inApp: true, email: true, mobile: false };
    return new NotificationPreferences({
      userId,
      channels: {
        mention: all,
        assignment: all,
        comment: inboxOnly,
        statusChange: inboxOnly,
        dueDate: all,
        access: inboxAndEmail,
        billing: inboxAndEmail,
      },
      digest: 'daily',
      doNotDisturb: true,
      version: 1,
    });
  }

  /** Reconstitutes the saved preferences of one authenticated account. */
  public static restore(snapshot: NotificationPreferencesSnapshot): NotificationPreferences {
    return new NotificationPreferences(snapshot);
  }

  /** Applies only supplied fields and preserves the version for a semantic no-op. */
  public patch(input: NotificationPreferencesPatch): NotificationPreferences {
    requireNonNull(input.channels);
    requireNonNull(input.digest);
    requireNonNull(input.doNotDisturb);
    const { channels, digest, doNotDisturb, version } = this.snapshot;
    const nextChannels = { ...channels };
    const nextDigest = input.digest ?? digest;
    const nextDnd = input.doNotDisturb ?? doNotDisturb;
    for (const category of categories) {
      const patch = input.channels?.[category];
      if (patch === undefined) continue;
      requireNonNull(patch);
      nextChannels[category] = { ...channels[category], ...patch };
    }

    if (
      nextDigest === digest &&
      nextDnd === doNotDisturb &&
      categories.every((category) => sameSettings(channels[category], nextChannels[category]))
    ) {
      return this;
    }
    return new NotificationPreferences({
      ...this.snapshot,
      channels: nextChannels,
      digest: nextDigest,
      doNotDisturb: nextDnd,
      version: version + 1,
    });
  }

  /**
   * Returns the activity-email cadence for a category. The contract applies mobile quiet hours
   * only to mobile delivery. Security email bypasses these preferences in its own flow.
   */
  public emailCadence(category: Category): Digest {
    return this.snapshot.channels[category].email ? this.snapshot.digest : 'never';
  }
  // #endregion
}

/** Keeps only validated channel flags in stable, deeply immutable state. */
function ownChannels(channels: Channels | null | undefined): Channels {
  return Object.freeze({
    mention: ownSettings(channels?.mention),
    assignment: ownSettings(channels?.assignment),
    comment: ownSettings(channels?.comment),
    statusChange: ownSettings(channels?.statusChange),
    dueDate: ownSettings(channels?.dueDate),
    access: ownSettings(channels?.access),
    billing: ownSettings(channels?.billing),
  });
}

/** Validates and freezes one category's three independent channel flags. */
function ownSettings(settings: ChannelSettings | undefined): ChannelSettings {
  if (
    typeof settings?.inApp !== 'boolean' ||
    typeof settings.email !== 'boolean' ||
    typeof settings.mobile !== 'boolean'
  ) {
    throw new NotificationPreferencesError();
  }
  return Object.freeze({ inApp: settings.inApp, email: settings.email, mobile: settings.mobile });
}

/** Rejects explicit null in a preferences patch, which only admits omitted settings. */
function requireNonNull(value: unknown): void {
  if (value === null) throw new NotificationPreferencesError();
}

/** Compares only the established flags when deciding whether a change was effective. */
function sameSettings(left: ChannelSettings, right: ChannelSettings): boolean {
  return left.inApp === right.inApp && left.email === right.email && left.mobile === right.mobile;
}
