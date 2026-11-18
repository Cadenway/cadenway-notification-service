import { describe, expect, it } from 'vitest';
import { InvalidSendWindowError } from '../../errors/security-email/invalid-send-window.error.js';
import { SendWindow } from '../../value-objects/security-email/send-window.value-object.js';
import { decideSecurityEmail, noticeWindow } from './security-email.policy.js';

/**
 * Constant occurredAt
 *
 * @description
 * When Camille Martin asked for a reset link in the mockup: 9 November 2026, 14:10 in Paris.
 *
 * @type {Date}
 */
const occurredAt: Date = new Date('2026-11-09T13:10:00.000Z');

/**
 * Constant linkExpiresAt
 *
 * @description
 * Thirty minutes later, when the link stops working.
 *
 * @type {Date}
 */
const linkExpiresAt: Date = new Date('2026-11-09T13:40:00.000Z');

describe('SendWindow', () => {
  it('says how long a reset link is valid, in whole minutes: 30', () => {
    expect(SendWindow.between(occurredAt, linkExpiresAt).minutes).toBe(30);
  });

  it('rounds a few milliseconds between the two instants of the event, and counts one minute at least', () => {
    expect(SendWindow.between(new Date(occurredAt.getTime() + 40), linkExpiresAt).minutes).toBe(30);
    expect(SendWindow.between(occurredAt, new Date(occurredAt.getTime() + 1_000)).minutes).toBe(1);
  });

  it('refuses a window that does not close after its event and within a day', () => {
    expect(() => SendWindow.between(linkExpiresAt, occurredAt)).toThrow(InvalidSendWindowError);
    expect(() => SendWindow.between(occurredAt, occurredAt)).toThrow(InvalidSendWindowError);
    expect(() =>
      SendWindow.between(occurredAt, new Date(occurredAt.getTime() + 86_400_001)),
    ).toThrow(InvalidSendWindowError);
    expect(() => SendWindow.between(new Date(Number.NaN), linkExpiresAt)).toThrow(
      InvalidSendWindowError,
    );
  });

  it('keeps its own copy of the instants', () => {
    const end: Date = new Date(linkExpiresAt.getTime());
    const window: SendWindow = SendWindow.between(occurredAt, end);

    end.setTime(0);

    expect(window.sendBefore).toEqual(linkExpiresAt);
  });

  it('closes at its last instant, as identity-service refuses an expired link from then on', () => {
    const window: SendWindow = SendWindow.between(occurredAt, linkExpiresAt);

    expect(window.isClosedAt(new Date(linkExpiresAt.getTime() - 1))).toBe(false);
    expect(window.isClosedAt(linkExpiresAt)).toBe(true);
  });
});

describe('noticeWindow', () => {
  it('lets a notice leave for a day after its event', () => {
    const window: SendWindow = noticeWindow(occurredAt);

    expect(window.occurredAt).toEqual(occurredAt);
    expect(window.sendBefore).toEqual(new Date('2026-11-10T13:10:00.000Z'));
  });
});

describe('decideSecurityEmail', () => {
  it('sends while the window is open, whatever the preferences: a security e-mail is always sent', () => {
    expect(
      decideSecurityEmail(
        'password-reset',
        SendWindow.between(occurredAt, linkExpiresAt),
        occurredAt,
      ),
    ).toEqual({ kind: 'send' });
  });

  it('skips an e-mail whose window closed, as the contract forbids sending an expired link', () => {
    expect(
      decideSecurityEmail(
        'password-reset',
        SendWindow.between(occurredAt, linkExpiresAt),
        linkExpiresAt,
      ),
    ).toEqual({ kind: 'skip', reason: 'expired' });
  });

  it('skips an event that asks for no e-mail this version knows, even while its window is open', () => {
    expect(decideSecurityEmail(null, noticeWindow(occurredAt), occurredAt)).toEqual({
      kind: 'skip',
      reason: 'change-not-supported',
    });
  });
});
