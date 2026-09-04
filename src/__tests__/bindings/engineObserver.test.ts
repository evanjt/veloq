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

function clientWithFakeEngine(): { client: InstanceType<typeof EngineClient>; observer: Observer } {
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
  const offs = channels.map((c) =>
    client.subscribe(c, (payload) => seen.push([c, payload]))
  );

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
