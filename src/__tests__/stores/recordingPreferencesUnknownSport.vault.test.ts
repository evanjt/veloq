/**
 * Scenario: a stored preferences file carries a sport the recorder does not
 * know, written by an older build or a link that named a made-up sport.
 *
 * Expected behaviour: the unknown sport is dropped on load and never written,
 * so it does not sit in the recent and recorded lists for good.
 */
import type { ActivityType } from '@/types';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

const mockStored = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockStored.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockStored.set(key, value);
  }),
}));

beforeEach(() => {
  mockStored.clear();
  useRecordingPreferences.setState({
    recentActivityTypes: [],
    recordedActivityTypes: [],
    isLoaded: false,
  });
});

it('drops an unknown sport from both lists on load', async () => {
  mockStored.set(
    'veloq-recording-preferences',
    JSON.stringify({
      recentActivityTypes: ['Bogus', 'Ride', 'constructor', 7],
      recordedActivityTypes: ['Run', 'toString'],
    })
  );

  await useRecordingPreferences.getState().initialise();

  const { recentActivityTypes, recordedActivityTypes } = useRecordingPreferences.getState();
  expect(recentActivityTypes).toEqual(['Ride']);
  expect(recordedActivityTypes).toEqual(['Run', 'Ride']);
});

it('records no unknown sport as recent', () => {
  useRecordingPreferences.getState().addRecentType('Ride');
  useRecordingPreferences.getState().addRecentType('Bogus' as ActivityType);

  const { recentActivityTypes, recordedActivityTypes } = useRecordingPreferences.getState();
  expect(recentActivityTypes).toEqual(['Ride']);
  expect(recordedActivityTypes).toEqual(['Ride']);
});
