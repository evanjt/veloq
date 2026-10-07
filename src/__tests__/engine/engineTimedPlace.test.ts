/**
 * Scenario: the FFI gate holds a call to the budget of the place it is made
 * from, and reads that place out of the ring entry's name.
 *
 * Expected behaviour: a tagged call is recorded as `name@place`, an untagged
 * call under its bare name, and nothing is recorded while debug is off.
 */
import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

describe('EngineClient.timed', () => {
  const recorded: string[] = [];

  beforeEach(() => {
    recorded.length = 0;
    EngineClient.setMetricRecorder((name) => recorded.push(name));
  });

  afterEach(() => {
    EngineClient.setDebugEnabled(false);
    EngineClient.setMetricRecorder(() => {});
  });

  it('records the place in the name and returns the result', () => {
    EngineClient.setDebugEnabled(true);
    const client = EngineClient.getInstance();
    expect(client.timed('readA', () => 7, 'mount')).toBe(7);
    expect(client.timed('readB', () => 8)).toBe(8);
    expect(recorded).toEqual(['readA@mount', 'readB']);
  });

  it('records nothing while debug is off', () => {
    const client = EngineClient.getInstance();
    expect(client.timed('readA', () => 1, 'gesture')).toBe(1);
    expect(recorded).toEqual([]);
  });
});

describe('launch calls', () => {
  const recorded: string[] = [];

  beforeEach(() => {
    recorded.length = 0;
    EngineClient.setMetricRecorder((name) => recorded.push(name));
    EngineClient.setDebugEnabled(true);
  });

  afterEach(() => {
    EngineClient.setDebugEnabled(false);
    EngineClient.setMetricRecorder(() => {});
  });

  it('records launchData under the launch place', () => {
    const { launchData } = require('../../../modules/veloqrs/src/delegates/launch');
    const stats = { activityCount: 1 };
    const host = {
      ready: true,
      heatmapTilesPath: null,
      engine: { launchData: () => stats },
      timed: EngineClient.getInstance().timed.bind(EngineClient.getInstance()),
    };
    const input = { routeWord: 'r', sectionWord: 's', athleteId: null, heatmapEnabled: false };
    expect(launchData(host, input)).toBe(stats);
    expect(recorded).toEqual(['launchData@launch']);
  });
});

describe('gesture-time calls', () => {
  const recorded: string[] = [];

  beforeEach(() => {
    recorded.length = 0;
    EngineClient.setMetricRecorder((name) => recorded.push(name));
    EngineClient.setDebugEnabled(true);
  });

  afterEach(() => {
    EngineClient.setDebugEnabled(false);
    EngineClient.setMetricRecorder(() => {});
  });

  const hostWith = (engine: object) => ({
    ready: true,
    engine,
    timed: EngineClient.getInstance().timed.bind(EngineClient.getInstance()),
  });

  it('records a viewport query under the gesture place', () => {
    const { queryViewport } = require('../../../modules/veloqrs/src/delegates/maps');
    const host = hostWith({ maps: () => ({ queryViewport: () => ['a'] }) });
    expect(queryViewport(host, 0, 1, 0, 1)).toEqual(['a']);
    expect(recorded).toEqual(['queryViewport@gesture']);
  });

  it('records the first page of the routes read as a mount and every later page as a gesture', () => {
    const { getRoutesScreenData } = require('../../../modules/veloqrs/src/delegates/routes');
    const host = hostWith({ routes: () => ({ getScreenData: () => ({}) }) });
    const page = (groupOffset: number, sectionOffset: number) =>
      ({ groupOffset, sectionOffset }) as never;
    getRoutesScreenData(host, page(0, 0));
    getRoutesScreenData(host, page(20, 0));
    getRoutesScreenData(host, page(0, 20));
    expect(recorded).toEqual([
      'getRoutesScreenData@mount',
      'getRoutesScreenData@gesture',
      'getRoutesScreenData@gesture',
    ]);
  });
});
