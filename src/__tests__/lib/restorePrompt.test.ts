/**
 * Scenario: an athlete signs in to an empty library on a phone with no device
 * backup, or whose device-backup record zip the engine refused. Their backups
 * may be in a file or on a WebDAV server, and nothing else tells them so.
 *
 * Expected behaviour: the first signed-in launch on an empty library offers a
 * restore once, and only when a backup was found. With none found nothing
 * opens. A library that holds
 * activities, a record already applied or answered, and a prompt that was
 * dismissed are never offered it again.
 */

import { restorePromptDue, answerRestorePrompt } from '@/features/settings/lib/restorePrompt';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
}));

beforeEach(() => mockSettings.clear());

describe('the restore prompt on an empty library', () => {
  it('is due when the library is empty, a backup was found and nothing has answered it', () => {
    expect(restorePromptDue(0, true)).toBe(true);
  });

  it('is not due on a first launch where no backup was found', () => {
    expect(restorePromptDue(0, false)).toBe(false);
  });

  it('is not due on a library that holds activities', () => {
    expect(restorePromptDue(1, true)).toBe(false);
  });

  it('is not due once a platform record was applied or this library wrote one', () => {
    mockSettings.set('__platform_record_answered', '1');
    expect(restorePromptDue(0, true)).toBe(false);
  });

  it('never returns once it is dismissed', () => {
    expect(restorePromptDue(0, true)).toBe(true);
    answerRestorePrompt();
    expect(restorePromptDue(0, true)).toBe(false);
    expect(restorePromptDue(0, true)).toBe(false);
  });
});
