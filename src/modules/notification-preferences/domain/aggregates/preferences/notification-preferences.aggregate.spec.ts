import { describe, expect, it } from 'vitest';

import { NotificationPreferencesError } from '../../errors/preferences/notification-preferences.error.js';
import { NotificationPreferences } from './notification-preferences.aggregate.js';

const userId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03';

describe('NotificationPreferences', () => {
  it('uses the account settings defaults from the mockup', () => {
    const preferences = NotificationPreferences.defaults(userId);

    expect(preferences.snapshot).toEqual({
      userId,
      channels: {
        mention: { inApp: true, email: true, mobile: true },
        assignment: { inApp: true, email: true, mobile: true },
        comment: { inApp: true, email: false, mobile: false },
        statusChange: { inApp: true, email: false, mobile: false },
        dueDate: { inApp: true, email: true, mobile: true },
        access: { inApp: true, email: true, mobile: false },
        billing: { inApp: true, email: true, mobile: false },
      },
      digest: 'daily',
      doNotDisturb: true,
      version: 1,
    });
  });

  it('merges only explicit channels and flags with one version advance', () => {
    const original = NotificationPreferences.defaults(userId);
    const changed = original.patch({
      channels: { mention: { email: false }, billing: { mobile: true } },
      digest: 'weekly',
    });

    expect(changed.snapshot).toEqual({
      ...original.snapshot,
      channels: {
        ...original.snapshot.channels,
        mention: { inApp: true, email: false, mobile: true },
        billing: { inApp: true, email: true, mobile: true },
      },
      digest: 'weekly',
      version: 2,
    });
    expect(changed.patch({ channels: { comment: {}, billing: { mobile: true } } })).toBe(changed);
    expect(changed.patch({})).toBe(changed);
    expect(changed.patch({ doNotDisturb: false }).snapshot.version).toBe(3);
  });

  it('keeps email selection independent of mobile quiet hours and never disables flags', () => {
    const initial = NotificationPreferences.defaults(userId);
    expect(initial.emailCadence('comment')).toBe('never');
    expect(initial.emailCadence('mention')).toBe('daily');
    expect(initial.patch({ doNotDisturb: false }).emailCadence('mention')).toBe('daily');

    const stopped = initial.patch({ digest: 'never' });
    expect(stopped.emailCadence('mention')).toBe('never');
    expect(stopped.snapshot.channels.mention.email).toBe(true);
    expect(stopped.patch({ digest: 'each' }).emailCadence('mention')).toBe('each');
  });

  it('rejects invalid versions and invalid data restored from persistence', () => {
    const original = NotificationPreferences.defaults(userId);

    expect(() => NotificationPreferences.restore({ ...original.snapshot, version: 0 })).toThrow(
      NotificationPreferencesError,
    );
    expect(() => original.patch({ digest: 'monthly' as never })).toThrow(
      NotificationPreferencesError,
    );
    expect(() => original.patch({ channels: { mention: { mobile: null as never } } })).toThrow(
      NotificationPreferencesError,
    );
  });
});
