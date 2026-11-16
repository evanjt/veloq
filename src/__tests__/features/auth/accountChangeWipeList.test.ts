/**
 * Scenario: an athlete signing in as another account, or into demo mode, reads
 * the confirm that says what this device deletes. Imported activities were
 * never sent to intervals.icu, so they do not come back at the next sign-in,
 * and the confirm has to name them with the other data deleted for good.
 *
 * Expected behaviour: each account-change confirm carries every line of the
 * wipe's deleted list under its heading, the same list Sign out and delete
 * data reads.
 */
import { Alert, Platform } from 'react-native';
import type { TFunction } from 'i18next';

import { i18n, initialiseI18n } from '@/i18n';
import { confirmAccountChange, promptAccountMismatch } from '@/features/auth/lib/accountChange';
import { wipeLines, wipeLineText } from '@/shared/storage';

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: { getState: () => ({ clearCredentials: jest.fn() }) },
}));

const originalOs = Platform.OS;

/** The message the most recent confirm handed to the dialog. */
function shownMessage(): string {
  return (Alert.alert as jest.Mock).mock.calls.at(-1)?.[1] as string;
}

function deletedLinesAsShown(): string[] {
  const t = i18n.t.bind(i18n) as unknown as TFunction;
  return wipeLines('deleted').map((line) => `• ${wipeLineText(line, t)}`);
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  Platform.OS = 'android';
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = originalOs;
  jest.restoreAllMocks();
});

it('the sign-in account change names every deleted line', () => {
  void confirmAccountChange({ cachedAthleteId: 'i123456', incomingKind: 'login' });

  const message = shownMessage();
  expect(message).toContain(i18n.t('alerts.wipeList.deleted'));
  for (const line of deletedLinesAsShown()) expect(message).toContain(line);
});

it('the demo account change names every deleted line', () => {
  void confirmAccountChange({ cachedAthleteId: 'i123456', incomingKind: 'demo' });

  const message = shownMessage();
  expect(message).toContain(i18n.t('alerts.wipeList.deleted'));
  for (const line of deletedLinesAsShown()) expect(message).toContain(line);
});

it('the library mismatch prompt names every deleted line', () => {
  void promptAccountMismatch({
    storedAthleteId: 'i123456',
    credentialsAthleteId: 'i654321',
    activityCount: 12,
  });

  const message = shownMessage();
  expect(message).toContain(i18n.t('alerts.wipeList.deleted'));
  for (const line of deletedLinesAsShown()) expect(message).toContain(line);
});
