/**
 * Scenario: the Developer Dashboard's FFI table reads the ring that
 * `host.timed` fills, so a synchronous engine call outside it reads as never made.
 *
 * Expected behaviour: each call below leaves one ring entry under its export name.
 */
import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';
import * as settings from '../../../modules/veloqrs/src/delegates/settings';
import * as heatmap from '../../../modules/veloqrs/src/delegates/heatmap';
import * as cutover from '../../../modules/veloqrs/src/delegates/cutover';
import * as visibility from '../../../modules/veloqrs/src/delegates/sections/visibility';
import * as history from '../../../modules/veloqrs/src/delegates/sections/history';

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  ...jest.requireActual('../../../modules/veloqrs/src/generated/veloqrs'),
  setEngineLogLevel: jest.fn(),
  getChangeCardSupport: () => ({}),
  startFetchAndStore: () => 1,
  getFetchRunProgress: () => ({ active: false, completed: 0, total: 0 }),
  cancelFetchAndStore: () => true,
  takeFetchAndStoreResult: () => undefined,
  takeQuarantineReport: () => undefined,
}));

const anyCall = new Proxy(
  {},
  { get: () => () => ({ encodedTrack: new ArrayBuffer(0), length: 0 }) }
) as never;
const engine = {
  settings: () => anyCall,
  heatmap: () => anyCall,
  sections: () => ({
    disable: () => {},
    enable: () => {},
    getHistory: () => [],
    getGeometryVersionCoords: () => new ArrayBuffer(0),
    unpin: () => {},
    getPinnedVersion: () => 1,
    getRetired: () => [],
  }),
};

const cases: [string, (h: never) => unknown][] = [
  ['getSetting', (h) => settings.getSetting(h, 'k')],
  ['engineInstall', (h) => settings.engineInstall(h)],
  ['streamRetentionDays', (h) => settings.streamRetentionDays(h)],
  ['streamStoreBytes', (h) => settings.streamStoreBytes(h)],
  ['setPriorityView', (h) => heatmap.setHeatmapPriorityView(h, 1, 2, 3)],
  ['clearPriorityView', (h) => heatmap.clearHeatmapPriorityView(h)],
  ['cancel', (h) => heatmap.cancelHeatmapWork(h)],
  ['getProgress', (h) => heatmap.getHeatmapTileProgress(h)],
  ['poll', (h) => heatmap.pollTileGeneration(h)],
  ['getChangeCardSupport', (h) => cutover.getChangeCardSupport(h)],
  ['disable', (h) => visibility.disableSection(h, 's')],
  ['enable', (h) => visibility.enableSection(h, 's')],
  ['getHistory', (h) => history.getSectionHistory(h, 's')],
  ['getGeometryVersionCoords', (h) => history.getSectionGeometryVersionPolyline(h, 's', 1)],
  ['unpin', (h) => history.unpinSection(h, 's')],
  ['getPinnedVersion', (h) => history.getPinnedSectionVersion(h, 's')],
  ['getRetired', (h) => history.getRetiredSections(h)],
];

const clientCases: [string, (c: EngineClient) => unknown][] = [
  ['startFetchAndStore', (c) => c.startFetchAndStore(['a'], [], 0 as never)],
  ['getFetchRunProgress', (c) => c.getFetchRunProgress(1)],
  ['cancelFetchAndStore', (c) => c.cancelFetchAndStore(1)],
  ['takeFetchAndStoreResult', (c) => c.takeFetchAndStoreResult(1)],
  [
    'takeQuarantineReport',
    (c) => {
      (c as unknown as { initialised: boolean }).initialised = true;
      return c.takeQuarantineReport();
    },
  ],
];

describe('synchronous engine calls reach the FFI ring', () => {
  const recorded: string[] = [];
  const client = EngineClient.getInstance();
  const host = {
    ready: true,
    engine,
    timed: client.timed.bind(client),
    notify: () => {},
    notifyAll: () => {},
  } as never;

  beforeEach(() => {
    recorded.length = 0;
    EngineClient.setMetricRecorder((name) => recorded.push(name));
    EngineClient.setDebugEnabled(true);
  });

  afterEach(() => {
    EngineClient.setDebugEnabled(false);
    EngineClient.setMetricRecorder(() => {});
  });

  it.each(cases)('%s is recorded', (name, call) => {
    call(host);
    expect(recorded).toContain(name);
  });

  it.each(clientCases)('%s on the client is recorded', (name, call) => {
    call(client);
    expect(recorded).toContain(name);
  });
});
