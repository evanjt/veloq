/**
 * Scenario: a library with no stored athlete id is on the device and an
 * athlete signs in.
 * Expected behaviour: activities present means the athlete is asked, and
 * only "This is mine" keeps it.
 */
import { Alert } from 'react-native';

import { resolveLoginLibrary } from '@/features/auth/lib/loginLibrary';
import * as accountChange from '@/features/auth/lib/accountChange';
import * as count from '@/features/auth/lib/storedActivityCount';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/features/auth/lib/storedActivityCount', () => ({
  resolveStoredActivityCount: jest.fn(),
}));
jest.mock('@/features/auth/lib/accountChange', () => ({
  ...jest.requireActual('@/features/auth/lib/accountChange'),
  getCachedAthleteId: jest.fn(),
  settleBeforeNamingLibrary: jest.fn().mockResolvedValue(undefined),
}));

function press(index: number) {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.[index]?.onPress?.();
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.mocked(accountChange.settleBeforeNamingLibrary).mockClear();
  jest.mocked(accountChange.getCachedAthleteId).mockResolvedValue(null);
  jest.mocked(count.resolveStoredActivityCount).mockResolvedValue(40);
});

it('keeps an unnamed library only when the athlete says it is theirs', async () => {
  press(1);
  expect(await resolveLoginLibrary('i-b')).toBe('keep');
  expect(accountChange.settleBeforeNamingLibrary).toHaveBeenCalled();
});

it('wipes an unnamed library when the athlete deletes it', async () => {
  press(2);
  expect(await resolveLoginLibrary('i-b')).toBe('wipe');
});

it('refuses and leaves the library alone on cancel', async () => {
  press(0);
  expect(await resolveLoginLibrary('i-b')).toBe('refused');
  expect(accountChange.settleBeforeNamingLibrary).not.toHaveBeenCalled();
});

it('signs in without a prompt over an unnamed empty library', async () => {
  jest.mocked(count.resolveStoredActivityCount).mockResolvedValue(0);
  const alert = jest.spyOn(Alert, 'alert');
  expect(await resolveLoginLibrary('i-b')).toBe('keep');
  expect(alert).not.toHaveBeenCalled();
});

it('keeps the same account without a prompt', async () => {
  jest.mocked(accountChange.getCachedAthleteId).mockResolvedValue('i-b');
  const alert = jest.spyOn(Alert, 'alert');
  expect(await resolveLoginLibrary('i-b')).toBe('keep');
  expect(alert).not.toHaveBeenCalled();
});

it('does not name an unnamed library for the incoming athlete when settlement fails', async () => {
  press(1);
  jest
    .mocked(accountChange.settleBeforeNamingLibrary)
    .mockRejectedValueOnce(new Error('disk full'));
  await expect(resolveLoginLibrary('i-b')).rejects.toThrow('disk full');
});
