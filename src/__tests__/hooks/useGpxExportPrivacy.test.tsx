/**
 * Scenario: the activity, route and section screens all share a GPX file
 * through one hook, and the athlete has asked for the start and end of tracks
 * near home to stay out of exports.
 *
 * Expected behaviour: the file is the one the engine built, under the name the
 * engine chose, nothing is shared when the trim leaves too little, and nothing
 * is shared when the engine cannot answer.
 */

import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useGpxExport } from '@/features/settings/hooks/useGpxExport';
import { getEngine } from '@/shared/native/engine';
import { shareFile } from '@/features/settings/lib/shareFile';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/settings/lib/shareFile', () => ({ shareFile: jest.fn() }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockShare = shareFile as jest.MockedFunction<typeof shareFile>;

const door = { latitude: 46.2333, longitude: 7.36 };
const away = { latitude: 46.25, longitude: 7.36 };
const farther = { latitude: 46.26, longitude: 7.36 };

function engineReturning(result: unknown) {
  const buildGpxFile = jest.fn(() => result);
  mockGetEngine.mockReturnValue({ buildGpxFile } as unknown as ReturnType<typeof getEngine>);
  return buildGpxFile;
}

async function run(points: { latitude: number; longitude: number }[]) {
  const { result } = renderHook(() => useGpxExport());
  await act(async () => {
    await result.current.exportGpx({
      name: 'Morning ride',
      points,
      sport: 'Ride',
      time: '2026-09-22T07:00:00',
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

it('shares the file the engine built, named as the engine named it', async () => {
  const build = engineReturning({ filename: 'Morning_ride.gpx', content: '<gpx/>' });

  await run([door, away, farther, door]);

  expect(build).toHaveBeenCalledWith('Morning ride', 'Ride', '2026-09-22T07:00:00', [
    door,
    away,
    farther,
    door,
  ]);
  expect(mockShare).toHaveBeenCalledWith({
    content: '<gpx/>',
    filename: 'Morning_ride.gpx',
    mimeType: 'application/gpx+xml',
  });
});

it('shares nothing and says why when the trim leaves too little of the track', async () => {
  engineReturning(null);

  await run([door, door]);

  expect(mockShare).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('common.error', 'export.gpxTrimmedAway');
});

it('shares nothing when the engine is not there to apply the trim', async () => {
  mockGetEngine.mockReturnValue(null);

  await run([door, away]);

  expect(mockShare).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('common.error', 'export.error');
});
