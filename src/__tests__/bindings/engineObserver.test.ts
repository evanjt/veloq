/**
 * Scenario: work that settles on a Rust thread had no way to reach the
 * TypeScript listener map, so every hook awaiting a result re-read on a timer.
 *
 * Expected behaviour: the engine registers one observer at init, each of its
 * methods lands on the matching channel, and none of them runs on the calling
 * Rust thread, which the binding blocks until the method returns.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

type Observer = Record<string, (...args: unknown[]) => void>;

type Client = ReturnType<typeof EngineClient.getInstance>;

function clientWithFakeEngine(): { client: Client; observer: Observer } {
  const client = EngineClient.getInstance();
  let registered: Observer | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).engine = {
    setObserver: (o: Observer) => {
      registered = o;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).engine.setObserver((client as any).observer());
  return { client, observer: registered! };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

it('routes every observer method onto its channel', async () => {
  const { client, observer } = clientWithFakeEngine();
  const seen: [string, unknown][] = [];
  const channels = [
    'syncProgress',
    'syncSettled',
    'bodyStored',
    'timeStreamsStored',
    'gpsTrackStored',
    'fitParsed',
    'detectionApplied',
    'tilesGenerated',
    'backfillPhase',
    'cutoverSettled',
    'previewFinished',
  ];
  const offs = channels.map((c) => client.subscribe(c, (payload) => seen.push([c, payload])));

  observer.syncProgress();
  observer.bodyStored('power_curve', 'a1');
  observer.timeStreamsStored(['a1', 'a2']);
  observer.gpsTrackStored('a3');
  observer.fitParsed('a4');
  observer.detectionApplied();
  observer.tilesGenerated();
  observer.backfillPhase('running');
  observer.cutoverSettled();
  observer.previewFinished();
  observer.syncSettled();
  await flush();

  expect(seen).toEqual([
    ['syncProgress', undefined],
    ['bodyStored', { kind: 'power_curve', activityId: 'a1' }],
    ['timeStreamsStored', { activityIds: ['a1', 'a2'] }],
    ['gpsTrackStored', { activityId: 'a3' }],
    ['fitParsed', { activityId: 'a4' }],
    ['detectionApplied', undefined],
    ['tilesGenerated', undefined],
    ['backfillPhase', { phase: 'running' }],
    ['cutoverSettled', undefined],
    ['previewFinished', undefined],
    ['syncSettled', undefined],
  ]);
  offs.forEach((off) => off());
});

it('fans the settle out on the coarse sync channel too', async () => {
  const { client, observer } = clientWithFakeEngine();
  const seen: string[] = [];
  const off = client.subscribe('sync', () => seen.push('sync'));

  observer.syncSettled();
  await flush();

  expect(seen).toEqual(['sync']);
  off();
});

it('returns to the calling thread before any listener runs', () => {
  const { client, observer } = clientWithFakeEngine();
  let ran = false;
  const off = client.subscribe('detectionApplied', () => {
    ran = true;
  });

  observer.detectionApplied();
  expect(ran).toBe(false);

  off();
});

it('delivers nothing to a listener that unsubscribed before the microtask', async () => {
  const { client, observer } = clientWithFakeEngine();
  let ran = false;
  const off = client.subscribe('tilesGenerated', () => {
    ran = true;
  });

  observer.tilesGenerated();
  off();
  await flush();

  expect(ran).toBe(false);
});

it('refreshes the sections channel when a detection run ends', async () => {
  const { client, observer } = clientWithFakeEngine();
  const seen: string[] = [];
  const off = client.subscribe('sections', () => seen.push('sections'));

  observer.detectionApplied();
  await flush();

  expect(seen).toEqual(['sections']);
  off();
});

it('refreshes the groups channel when a regroup is swapped in', async () => {
  const { client, observer } = clientWithFakeEngine();
  const seen: string[] = [];
  const off = client.subscribe('groups', () => seen.push('groups'));
  const heard: string[] = [];
  const offEvent = client.subscribe('groupsChanged', () => heard.push('groupsChanged'));

  observer.groupsChanged();
  await flush();

  expect(seen).toEqual(['groups']);
  expect(heard).toEqual(['groupsChanged']);
  off();
  offEvent();
});

it('refreshes activity reads when stored rows are announced', async () => {
  const { client, observer } = clientWithFakeEngine();
  const read = jest.fn();
  const off = client.subscribe('activities', read);

  observer.activitiesStored();
  await flush();

  expect(read).toHaveBeenCalledTimes(1);
  off();
});

it.each(['restoreRecordZip', 'restoreRecordJson'] as const)(
  'rereads mounted engine data after %s commits without a sync',
  async (method) => {
    const { client } = clientWithFakeEngine();
    let name = 'Old name';
    const read = jest.fn(() => name);
    const seen: string[] = [];
    const offs = ['activities', 'groups', 'sections', 'sync'].map((channel) =>
      client.subscribe(channel, () => seen.push(read()))
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.engine as any)[method] = jest.fn().mockImplementation(async () => {
      name = 'Restored name';
      return { placed: 1, unplaced: 0, missingActivityIds: [] };
    });

    expect(read()).toBe('Old name');
    await client[method]('record');
    await flush();

    expect(seen).toContain('Restored name');
    expect(seen).toHaveLength(4);
    offs.forEach((off) => off());
  }
);

it('keeps mounted reads unchanged after a refused restore and refreshes on retry', async () => {
  const { client } = clientWithFakeEngine();
  const read = jest.fn();
  const off = client.subscribe('groups', read);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.engine as any).restoreRecordJson = jest
    .fn()
    .mockRejectedValueOnce(new Error('Invalid record'))
    .mockResolvedValueOnce({ placed: 1, unplaced: 0, missingActivityIds: [] });

  await expect(client.restoreRecordJson('invalid')).rejects.toThrow('Invalid record');
  await flush();
  expect(read).not.toHaveBeenCalled();

  await client.restoreRecordJson('valid');
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  off();
});
