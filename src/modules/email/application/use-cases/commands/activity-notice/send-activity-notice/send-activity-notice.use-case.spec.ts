import { describe, expect, it, vi } from 'vitest';
import type { ActivityNoticeRenderer } from '../../../../ports/outbound/templates/activity-notice/activity-notice-renderer.port.js';
import type { EmailSender } from '../../../../ports/outbound/smtp/code-email/email-sender.port.js';
import { SendActivityNotice } from './send-activity-notice.use-case.js';

const authorized = {
  occurrenceId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12',
  address: 'recipient@example.test',
  language: 'en-GB',
  count: 2,
  validUntil: Date.parse('2026-11-20T09:00:30Z'),
};
const rendered = { subject: 'Your Cadenway activity', html: '<p>Activity</p>', text: 'Activity' };

describe('SendActivityNotice', () => {
  it('renders only the account language and count and reuses the same delivery identifier', async () => {
    const renderer = { renderActivityNotice: vi.fn(() => rendered) };
    const sender = { send: vi.fn<EmailSender['send']>().mockResolvedValue(undefined) };
    const operation = new SendActivityNotice(renderer, sender, {
      now: () => new Date(authorized.validUntil - 1),
    });

    await operation.execute(authorized);
    await operation.execute({ ...authorized, occurrenceId: authorized.occurrenceId.toUpperCase() });

    expect(renderer.renderActivityNotice).toHaveBeenCalledWith('en-GB', 2);
    expect(sender.send.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [
        {
          ...rendered,
          id: `activity-${authorized.occurrenceId}`,
          to: { address: authorized.address, name: '' },
          unsubscribe: false,
        },
      ]),
    );
  });

  it('does not hand over the message when authorization has expired during rendering', async () => {
    let instant = authorized.validUntil - 1;
    const renderer: ActivityNoticeRenderer = {
      renderActivityNotice: () => {
        instant = authorized.validUntil;
        return rendered;
      },
    };
    const sender = { send: vi.fn<EmailSender['send']>() };
    const operation = new SendActivityNotice(renderer, sender, { now: () => new Date(instant) });

    await expect(operation.execute(authorized)).rejects.toThrow('authorization has expired');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('refuses a malformed occurrence before it can become a message header', async () => {
    const renderer = { renderActivityNotice: vi.fn(() => rendered) };
    const sender = { send: vi.fn<EmailSender['send']>() };
    const operation = new SendActivityNotice(renderer, sender, { now: () => new Date(0) });

    await expect(
      operation.execute({ ...authorized, occurrenceId: '<unexpected>' }),
    ).rejects.toThrow('invalid occurrence or count');
    expect(renderer.renderActivityNotice).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });
});
