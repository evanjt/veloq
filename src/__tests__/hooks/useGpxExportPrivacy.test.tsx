/**
 * Scenario: the activity, route and section screens all share a GPX file, and
 * the route and section screens also share a FIT course, through one hook. The
 * athlete has asked for the start and end of tracks near home to stay out of
 * exports.
 *
 * Expected behaviour: the file is the one the engine built, under the name the
 * engine chose, nothing is shared when the trim leaves too little, and nothing
 * is shared when the engine cannot answer.
 */

import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useGpxExport } from '@/features/settings/hooks/useGpxExport';
import { getEngine } from '@/shared/native/engine';
import { shareFile, shareFileBytes } from '@/features/settings/lib/shareFile';
import { settings } from 'veloqrs';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);
jest.mock('@/shared/native/engine', () => {
  const getEngine = jest.fn();
  return { getEngine, isEngineReady: () => getEngine() != null };
});
jest.mock('@/features/settings/lib/shareFile', () => ({
  shareFile: jest.fn(),
  shareFileBytes: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockShare = shareFile as jest.MockedFunction<typeof shareFile>;
const mockShareBytes = shareFileBytes as jest.MockedFunction<typeof shareFileBytes>;

const door = { latitude: 46.2333, longitude: 7.36 };
const away = { latitude: 46.25, longitude: 7.36 };
const farther = { latitude: 46.26, longitude: 7.36 };

function engineReturning(result: unknown) {
  const buildGpxFile = jest.fn(() => result);
  mockGetEngine.mockReturnValue({ buildGpxFile } as unknown as ReturnType<typeof getEngine>);
  return buildGpxFile;
}

async function run(points: { latitude: number; longitude: number }[]) {
  const { result } = await renderHook(() => useGpxExport());
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
    name: 'Morning_ride.gpx',
    kind: 'gpx',
    anchor: undefined,
  });
});

it('shares nothing and says why when the trim leaves too little of the track', async () => {
  engineReturning(null);

  await run([door, door]);

  expect(mockShare).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'export.failedTitle',
    'export.gpxTrimmedAway',
    undefined,
    expect.objectContaining({ cancelable: true })
  );
});

it('shares nothing when the engine is not there to apply the trim', async () => {
  mockGetEngine.mockReturnValue(null);

  await run([door, away]);

  expect(mockShare).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'export.failedTitle',
    'export.error',
    undefined,
    expect.objectContaining({ cancelable: true })
  );
});

describe('a route or section shared by its id', () => {
  it('hands the engine the route id and shares the file it built', async () => {
    jest
      .mocked(settings.buildRouteGpxFile)
      .mockReturnValueOnce({ filename: 'Lake_loop.gpx', content: '<gpx/>' });
    const { result } = await renderHook(() => useGpxExport());

    await act(async () => {
      await result.current.exportRouteGpx('g1', { sport: 'Ride' });
    });

    expect(settings.buildRouteGpxFile).toHaveBeenCalledWith('g1', 'Ride');
    expect(mockShare).toHaveBeenCalledWith({
      content: '<gpx/>',
      name: 'Lake_loop.gpx',
      kind: 'gpx',
      anchor: undefined,
    });
  });

  it('hands the engine the section id and shares nothing when the trim leaves too little', async () => {
    jest.mocked(settings.buildSectionGpxFile).mockReturnValueOnce(null);
    const { result } = await renderHook(() => useGpxExport());

    await act(async () => {
      await result.current.exportSectionGpx('sec-1', { sport: 'Ride' });
    });

    expect(settings.buildSectionGpxFile).toHaveBeenCalledWith('sec-1', 'Ride');
    expect(mockShare).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'export.failedTitle',
      'export.gpxTrimmedAway',
      undefined,
      expect.objectContaining({ cancelable: true })
    );
  });
});

describe('a route or section FIT course shared by its id', () => {
  it('shares the engine bytes unchanged, as a fit file the engine named', async () => {
    const content = new Uint8Array([0x0e, 0x10, 0xff]).buffer;
    jest.mocked(settings.buildRouteFitCourse).mockReturnValueOnce({
      filename: 'Lake_loop.fit',
      content,
    });
    const { result } = await renderHook(() => useGpxExport());

    await act(async () => {
      await result.current.exportRouteFit('g1', { sport: 'Ride' });
    });

    expect(settings.buildRouteFitCourse).toHaveBeenCalledWith('g1', 'Ride');
    expect(mockShareBytes).toHaveBeenCalledTimes(1);
    const shared = jest.mocked(shareFileBytes).mock.calls[0][0];
    expect(shared.bytes).toBe(content);
    expect(shared).toMatchObject({ name: 'Lake_loop.fit', kind: 'fit', anchor: undefined });
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('shares nothing and says why when the trim leaves too little of a section', async () => {
    jest.mocked(settings.buildSectionFitCourse).mockReturnValueOnce(null);
    const { result } = await renderHook(() => useGpxExport());

    await act(async () => {
      await result.current.exportSectionFit('sec-1', { sport: 'Ride' });
    });

    expect(settings.buildSectionFitCourse).toHaveBeenCalledWith('sec-1', 'Ride');
    expect(mockShareBytes).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'export.failedTitle',
      'export.gpxTrimmedAway',
      undefined,
      expect.objectContaining({ cancelable: true })
    );
  });
});
