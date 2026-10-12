/**
 * Scenario: an athlete signing in as another account sees the prompt that the
 * cached library will be deleted, and presses Android back or taps outside it.
 *
 * Expected behaviour: the dismissal is a refusal. The confirm resolves false,
 * so the login stops and nothing is deleted, rather than hanging on a Promise
 * only the buttons settle.
 */
import { Alert, Platform, type AlertOptions } from 'react-native';

import { initialiseI18n } from '@/i18n';
import { confirmAccountChange, promptAccountMismatch } from '@/features/auth/lib/accountChange';

const mockClearCredentials = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: { getState: () => ({ clearCredentials: mockClearCredentials }) },
}));

function dismissLastAlert() {
  const options = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[3] as AlertOptions | undefined;
  expect(options?.cancelable).toBe(true);
  options?.onDismiss?.();
}

const originalOs = Platform.OS;

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  Platform.OS = 'android';
  mockClearCredentials.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = originalOs;
  jest.restoreAllMocks();
});

it('resolves an account change refused by a dismissal to false', async () => {
  const answer = confirmAccountChange({ cachedAthleteId: 'i123456', incomingKind: 'login' });
  dismissLastAlert();
  await expect(answer).resolves.toBe(false);
});

it('signs out when the library mismatch prompt is dismissed, as Cancel does', async () => {
  const answer = promptAccountMismatch({
    storedAthleteId: 'i123456',
    credentialsAthleteId: 'i654321',
    activityCount: 12,
  });
  dismissLastAlert();
  await expect(answer).resolves.toBe(false);
  expect(mockClearCredentials).toHaveBeenCalledTimes(1);
});
