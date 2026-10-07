/**
 * Scenario: launch opens the library and then does its engine work. It took
 * five separate calls for the name translations, the heatmap toggle, the
 * athlete id write, the activity count and the stats, and each one is a lock
 * take between init and first paint that a sync page write can stall.
 *
 * Expected behaviour: one `launchData` call carries all of it, and the tiles
 * path the client holds for a re-open follows the athlete's toggle.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const STATS = {
  activityCount: 490,
  signatureCacheSize: 0,
  groupCount: 0,
  sectionCount: 0,
  groupsDirty: false,
  sectionsDirty: false,
  gpsTrackCount: 0,
  oldestDate: BigInt(1700000000),
  newestDate: BigInt(1760000000),
  activityWindowOldest: '2026-07-08',
};

const mockSettings = { getSetting: jest.fn(), setSetting: jest.fn() };
const mockHeatmap = { setTilesPath: jest.fn(), clearTilesPath: jest.fn() };
const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  destroy: jest.fn(),
  launchData: jest.fn(() => STATS),
  getStats: jest.fn(() => STATS),
  getActivityCount: jest.fn(() => 490),
  setNameTranslations: jest.fn(),
  settings: () => mockSettings,
  heatmap: () => mockHeatmap,
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  __esModule: true,
  default: { initialize: jest.fn() },
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: {
    create: () => mockNativeEngine,
  },
}));

const DB = '/data/routes.db';

function openClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  client.heatmapTilesPath = null;
  expect(client.initWithPath(DB)).toBe(true);
  return client;
}

describe('EngineClient.launchData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeEngine.launchData.mockReturnValue(STATS);
  });

  it('does the whole post-init block in one call across the binding', () => {
    const client = openClient();

    const stats = client.launchData({
      routeWord: 'Route',
      sectionWord: 'Section',
      athleteId: '12345',
      heatmapEnabled: true,
    });

    expect(stats).toBe(STATS);
    expect(mockNativeEngine.launchData).toHaveBeenCalledTimes(1);
    expect(mockNativeEngine.launchData).toHaveBeenCalledWith(
      'Route',
      'Section',
      '12345',
      client.heatmapTilesPath
    );
    expect(client.heatmapTilesPath).toBeTruthy();

    expect(mockNativeEngine.setNameTranslations).not.toHaveBeenCalled();
    expect(mockNativeEngine.getStats).not.toHaveBeenCalled();
    expect(mockNativeEngine.getActivityCount).not.toHaveBeenCalled();
    expect(mockSettings.setSetting).not.toHaveBeenCalled();
    expect(mockHeatmap.setTilesPath).not.toHaveBeenCalled();
  });

  it('hands down a null tiles path when the athlete has the heatmap off', () => {
    const client = openClient();

    client.launchData({
      routeWord: 'Route',
      sectionWord: 'Section',
      athleteId: null,
      heatmapEnabled: false,
    });

    expect(mockNativeEngine.launchData).toHaveBeenCalledWith(
      'Route',
      'Section',
      undefined,
      undefined
    );
    expect(client.heatmapTilesPath).toBeNull();
  });

  it('hands a failed call to the caller rather than answering no stats', () => {
    const client = openClient();
    const failure = new Error('closed');
    mockNativeEngine.launchData.mockImplementation(() => {
      throw failure;
    });

    expect(() =>
      client.launchData({
        routeWord: 'Route',
        sectionWord: 'Section',
        athleteId: '12345',
        heatmapEnabled: true,
      })
    ).toThrow(failure);
  });
});
