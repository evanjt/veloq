/**
 * Scenario: Android shows the notification dialog twice at most, so a record
 * screen that asks on every visit spends both on the first two rides.
 *
 * Expected behaviour: the ask is remembered across a restart, and a stored
 * file that predates it reads as not asked.
 */
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

const mockStored = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockStored.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockStored.set(key, value);
  }),
}));

const asked = () => useRecordingPreferences.getState().notificationsAsked;

async function restart() {
  useRecordingPreferences.setState({ notificationsAsked: false, isLoaded: false });
  await useRecordingPreferences.getState().initialise();
}

beforeEach(() => {
  mockStored.clear();
  useRecordingPreferences.setState({ notificationsAsked: false, isLoaded: true });
});

it('remembers the notification ask across a restart', async () => {
  useRecordingPreferences.getState().markNotificationsAsked();
  expect(asked()).toBe(true);

  await restart();
  expect(asked()).toBe(true);
});

it('reads a stored file from before the flag as not asked', async () => {
  mockStored.set('veloq-recording-preferences', JSON.stringify({ recentActivityTypes: ['Ride'] }));

  await restart();
  expect(asked()).toBe(false);
});

it('keeps the flag when another preference is written after it', async () => {
  useRecordingPreferences.getState().markNotificationsAsked();
  useRecordingPreferences.getState().setKeepAwake(false);

  await restart();
  expect(asked()).toBe(true);
});
