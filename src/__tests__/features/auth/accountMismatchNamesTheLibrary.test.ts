/**
 * Scenario: the engine holds athlete A's library of 500 activities and
 * athlete B signs in. The prompt's Clear & Sync deletes A's library.
 *
 * Expected behaviour: the prompt names whose library it is, how many
 * activities it holds and that clearing deletes them permanently. It says
 * nothing of a restore, because it opens for any library the engine holds.
 */

import { Alert } from 'react-native';

import { initializeI18n } from '@/i18n';
import { promptAccountMismatch } from '@/features/auth/lib/accountChange';

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: { getState: () => ({ clearCredentials: jest.fn() }) },
}));

function promptBody(activityCount: number): string {
  void promptAccountMismatch({
    storedAthleteId: 'i123456',
    credentialsAthleteId: 'i654321',
    activityCount,
  });
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return calls[calls.length - 1][1] as string;
}

beforeAll(async () => {
  await initializeI18n('en-GB');
});

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('the account mismatch prompt', () => {
  it('titles the on-device library without calling it a backup', () => {
    promptBody(500);
    const title = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(title).toMatch(/library.*device/i);
    expect(title).not.toMatch(/backup/i);
  });

  it('names the athlete whose library it deletes', () => {
    expect(promptBody(500)).toContain('i123456');
  });

  it('names how many activities it deletes', () => {
    expect(promptBody(500)).toContain('500 activities');
  });

  it('counts a single activity in the singular', () => {
    expect(promptBody(1)).toContain('1 activity ');
  });

  it('says the deletion is permanent', () => {
    expect(promptBody(500)).toMatch(/permanently/);
  });

  it('does not call the library restored', () => {
    expect(promptBody(500)).not.toMatch(/restored/i);
  });
});
