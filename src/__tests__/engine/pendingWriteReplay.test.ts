/**
 * Scenario: an athlete's write reaches a delegate before `initWithPath` has
 * opened the engine. Launch does this on every authenticated cold start, and
 * demo entry does it ten times over.
 *
 * Expected behaviour: a write is held in order and replayed once the engine
 * opens. A command that refers to work already in flight is not, because
 * replaying a cancel would cancel work the athlete did start.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockSync = {
  setCredentials: jest.fn(),
  clearCredentials: jest.fn(),
  cancel: jest.fn(),
};
const mockSettings = {
  setAthleteProfile: jest.fn(),
  setSportSettings: jest.fn(),
  setSetting: jest.fn(),
};
const mockFitness = { savePaceSnapshot: jest.fn() };
const mockActivities = { setMetrics: jest.fn(), setCurveBody: jest.fn() };

let initSucceeds = true;
const mockNativeEngine = {
  isInitialized: () => initSucceeds,
  setObserver: jest.fn(),
  destroy: jest.fn(),
  clear: jest.fn(),
  sync: () => mockSync,
  settings: () => mockSettings,
  fitness: () => mockFitness,
  activities: () => mockActivities,
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  VeloqEngine: {
    create: () => mockNativeEngine,
  },
}));

const DB = '/data/routes.db';

function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

describe('writes made before the engine opens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initSucceeds = true;
  });

  it('replays a credential written before init, exactly once', () => {
    const client = closedClient();

    client.setSyncCredentials('oauth', 'secret-token', '12345');
    expect(mockSync.setCredentials).not.toHaveBeenCalled();

    expect(client.initWithPath(DB)).toBe(true);

    expect(mockSync.setCredentials).toHaveBeenCalledTimes(1);
    expect(mockSync.setCredentials).toHaveBeenCalledWith('oauth', 'secret-token', '12345');
  });

  it('replays set, clear and set in the order they were written', () => {
    const client = closedClient();
    const order: string[] = [];
    mockSync.setCredentials.mockImplementation((_m, secret) => order.push(`set:${secret}`));
    mockSync.clearCredentials.mockImplementation(() => order.push('clear'));

    client.setSyncCredentials('api_key', 'first', 'a1');
    client.clearSyncCredentials();
    client.setSyncCredentials('oauth', 'second', 'a2');

    client.initWithPath(DB);

    expect(order).toEqual(['set:first', 'clear', 'set:second']);
  });

  it('replays the demo seed writes in order across delegate files', () => {
    const client = closedClient();
    const order: string[] = [];
    mockSettings.setAthleteProfile.mockImplementation(() => order.push('athleteProfile'));
    mockSettings.setSportSettings.mockImplementation(() => order.push('sportSettings'));
    mockSettings.setSetting.mockImplementation(() => order.push('setting'));
    mockFitness.savePaceSnapshot.mockImplementation(() => order.push('paceSnapshot'));
    mockActivities.setCurveBody.mockImplementation(() => order.push('curveBody'));

    client.setAthleteProfile('{"id":"demo"}');
    client.setSportSettings('{"Ride":{}}');
    client.setSetting('units', 'metric');
    client.savePaceSnapshot('Run', 4.2, 120, 0.98);
    client.setCurveBody('power', 'Ride', 90, false, '{}');

    expect(order).toEqual([]);

    client.initWithPath(DB);

    expect(order).toEqual([
      'athleteProfile',
      'sportSettings',
      'setting',
      'paceSnapshot',
      'curveBody',
    ]);
  });

  it('stamps a dateless pace snapshot with the write time, not the replay time', () => {
    jest.useFakeTimers();
    try {
      const client = closedClient();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const writtenAt = Math.floor(Date.now() / 1000);

      client.savePaceSnapshot('Run', 4.2);

      jest.setSystemTime(new Date('2026-01-02T00:00:00Z'));
      client.initWithPath(DB);

      expect(mockFitness.savePaceSnapshot).toHaveBeenCalledTimes(1);
      expect(mockFitness.savePaceSnapshot.mock.calls[0][4]).toBe(BigInt(writtenAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('writes straight through and holds nothing once the engine is open', () => {
    const client = closedClient();
    client.initWithPath(DB);

    client.setSetting('units', 'imperial');

    expect(mockSettings.setSetting).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any).pendingWrites).toHaveLength(0);
  });

  it('drops what it held when the engine is torn down before it opens', () => {
    const client = closedClient();

    client.setSetting('units', 'metric');
    client.destroyEngine();
    client.initWithPath(DB);

    expect(mockSettings.setSetting).not.toHaveBeenCalled();
  });

  it('does not replay a write held before clear()', () => {
    const client = closedClient();
    client.initWithPath(DB);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).pendingWrites = [
      { name: 'setSetting', run: () => mockSettings.setSetting('stale', 'value') },
    ];

    client.clear();

    expect(mockSettings.setSetting).not.toHaveBeenCalled();
  });

  it('keeps the queue when init fails and replays once on the retry', () => {
    const client = closedClient();
    initSucceeds = false;

    client.setSyncCredentials('oauth', 'secret-token', '12345');
    expect(client.initWithPath(DB)).toBe(false);
    expect(mockSync.setCredentials).not.toHaveBeenCalled();

    initSucceeds = true;
    expect(client.initWithPath(DB)).toBe(true);

    expect(mockSync.setCredentials).toHaveBeenCalledTimes(1);
  });

  it('never replays a cancel issued before the engine opened', () => {
    const client = closedClient();

    client.cancelSync();
    client.initWithPath(DB);

    expect(mockSync.cancel).not.toHaveBeenCalled();
  });

  it('bounds the queue and keeps the newest writes', () => {
    const client = closedClient();

    for (let i = 0; i < 300; i += 1) {
      client.setSetting(`key-${i}`, String(i));
    }

    client.initWithPath(DB);

    expect(mockSettings.setSetting).toHaveBeenCalledTimes(256);
    expect(mockSettings.setSetting.mock.calls[0][0]).toBe('key-44');
    expect(mockSettings.setSetting.mock.calls[255][0]).toBe('key-299');
  });

  it('replays the writes that follow one that throws', () => {
    const client = closedClient();
    mockSettings.setAthleteProfile.mockImplementation(() => {
      throw new Error('engine refused the profile');
    });

    client.setAthleteProfile('{"id":"demo"}');
    client.setSetting('units', 'metric');

    client.initWithPath(DB);

    expect(mockSettings.setSetting).toHaveBeenCalledWith('units', 'metric');
  });
});
