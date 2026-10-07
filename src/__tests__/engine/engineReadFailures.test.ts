/**
 * Scenario: every engine read throws, as it does when another thread holds the
 * database lock.
 *
 * Expected behaviour: each client read hands the `VeloqError` to its caller
 * with its tag intact, rather than answering `[]`, `{}`, `''`, `0`, `null` or
 * `undefined`, which a caller reads as nothing there. A closed engine still
 * answers its empty value without calling anything.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';
import { engineErrorTag } from '@/shared/native/engineError';

/** The shape a `VeloqError` crosses the binding in. */
function lockFailed(): Error {
  return Object.assign(new Error('Database'), {
    tag: 'Database',
    inner: { msg: 'another thread holds the lock' },
  });
}

const failing = () => {
  throw lockFailed();
};

// Every method on a sub-handle (`settings()`, `sections()`, ...) throws.
const failingHandle = new Proxy({}, { get: () => failing });

const mockNativeEngine = new Proxy(
  {
    isInitialized: () => true,
    initOutcome: () => 1,
    setObserver: () => undefined,
    settings: () => failingHandle,
    sections: () => failingHandle,
    detection: () => failingHandle,
    heatmap: () => failingHandle,
  } as Record<string, unknown>,
  { get: (target, key: string) => (key in target ? target[key] : failing) }
);

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => {
  const fail = () => {
    throw Object.assign(new Error('Database'), { tag: 'Database', inner: { msg: 'locked' } });
  };
  return {
    FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
    FfiStartOutcome: { NotReady: 0, Failed: 1 },
    VeloqEngine: { create: () => mockNativeEngine },
    SectionPreview: class {
      centres = fail;
      getProgress = fail;
      takeResult = fail;
    },
    takeQuarantineReport: fail,
    getNetworkPush: fail,
    getCutoverProgress: fail,
    getCutoverDiff: fail,
    getElevationBackfillRemaining: fail,
    getElevationBackfillProgress: fail,
    getRoutesStatusData: fail,
    getStreamBackfillRemaining: fail,
    getStreamBackfillProgress: fail,
  };
});

function resetClient(): EngineClient {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

function openClient(): EngineClient {
  const client = resetClient();
  expect(client.initWithPath('/data/routes.db')).toBe(true);
  return client;
}

const READS: [string, (client: EngineClient) => unknown][] = [
  ['takeQuarantineReport', (c) => c.takeQuarantineReport()],
  ['getStats', (c) => c.getStats()],
  ['pushRuns', (c) => c.pushRuns()],
  ['getActivitiesNeedingTimeStreams', (c) => c.getActivitiesNeedingTimeStreams()],
  ['getBackupMetadata', (c) => c.getBackupMetadata()],
  ['getNetworkPush', (c) => c.getNetworkPush()],
  ['getCutoverProgress', (c) => c.getCutoverProgress()],
  ['getCutoverDiff', (c) => c.getCutoverDiff()],
  ['sectionDetectionAwaiting', (c) => c.sectionDetectionAwaiting()],
  ['getElevationBackfillRemaining', (c) => c.getElevationBackfillRemaining()],
  ['getElevationBackfillProgress', (c) => c.getElevationBackfillProgress()],
  ['getHeatmapTileProgress', (c) => c.getHeatmapTileProgress()],
  [
    'launchData',
    (c) =>
      c.launchData({
        routeWord: 'Trail',
        sectionWord: 'Stretch',
        athleteId: null,
        heatmapEnabled: false,
      }),
  ],
  ['getPreviewCentres', (c) => c.getPreviewCentres(5)],
  ['getPreviewProgress', (c) => c.getPreviewProgress()],
  ['takePreviewResult', (c) => c.takePreviewResult()],
  ['getRoutesStatusData', (c) => c.getRoutesStatusData()],
  ['getSectionHistory', (c) => c.getSectionHistory('sec-1')],
  ['getSectionGeometryVersions', (c) => c.getSectionGeometryVersions('sec-1')],
  ['getSectionGeometryVersionPolyline', (c) => c.getSectionGeometryVersionPolyline('sec-1', 2)],
  ['getPinnedSectionVersion', (c) => c.getPinnedSectionVersion('sec-1')],
  ['getRetiredSections', (c) => c.getRetiredSections()],
  ['acceptAllSections', (c) => c.acceptAllSections()],
  ['getSectionExtensionTrack', (c) => c.getSectionExtensionTrack('sec-1')],
  ['getAthleteProfile', (c) => c.getAthleteProfile()],
  ['getSportSettings', (c) => c.getSportSettings()],
  ['hrZoneFor', (c) => c.hrZoneFor('Ride', 140)],
  ['suggestExportHome', (c) => c.suggestExportHome()],
  ['exportPrivacyPreview', (c) => c.exportPrivacyPreview(46.5, 6.6, 200)],
  ['engineInstall', (c) => c.engineInstall()],
  ['notificationTemplates', (c) => c.notificationTemplates()],
  ['streamRetentionDays', (c) => c.streamRetentionDays()],
  ['streamStoreBytes', (c) => c.streamStoreBytes()],
  ['getStreamBackfillRemaining', (c) => c.getStreamBackfillRemaining()],
  ['getStreamBackfillProgress', (c) => c.getStreamBackfillProgress()],
];

describe('engine client reads', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it.each(READS)('%s hands the failure to its caller with its tag', (_name, read) => {
    const client = openClient();

    let thrown: unknown;
    try {
      read(client);
    } catch (e) {
      thrown = e;
    }

    expect(engineErrorTag(thrown)).toBe('Database');
  });

  // These two read a process-wide value rather than the open library, so they
  // have no closed state to answer from.
  const PROCESS_WIDE = ['takeQuarantineReport', 'getNetworkPush'];

  it.each(READS.filter(([name]) => !PROCESS_WIDE.includes(name)))(
    '%s answers without calling the engine while it is closed',
    (_name, read) => {
      const client = resetClient();

      expect(() => read(client)).not.toThrow();
    }
  );
});
