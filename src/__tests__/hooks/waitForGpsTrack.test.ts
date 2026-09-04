/**
 * Scenario: the regional map asks Rust to download one activity's GPS, then
 * waited for it on a 250 ms timer. Every tick took the engine write lock and
 * decoded the track again.
 *
 * Expected behaviour: the wait reads once, then makes no engine call at all
 * until Rust announces that this activity's track landed.
 */

import { getEngine } from '@/shared/native/engine';
import { waitForGpsTrack } from '@/features/maps/lib/gpsTrackWait';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

type Listener = (payload?: { activityId: string }) => void;

function fakeEngine(track: { latitude: number; longitude: number }[] | null) {
  const listeners = new Map<string, Set<Listener>>();
  let stored = track;
  return {
    listeners,
    store: (points: { latitude: number; longitude: number }[]) => {
      stored = points;
    },
    announce: (event: string, payload?: { activityId: string }) =>
      listeners.get(event)?.forEach((cb) => cb(payload)),
    getGpsTrack: jest.fn(() => stored),
    subscribe: jest.fn((event: string, cb: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => listeners.get(event)?.delete(cb);
    }),
  };
}

type Engine = ReturnType<typeof getEngine>;

const points = [
  { latitude: -37.8, longitude: 144.9 },
  { latitude: -37.81, longitude: 144.91 },
];

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('answers a track that is already stored without subscribing', async () => {
  const engine = fakeEngine(points);
  mockGetEngine.mockReturnValue(engine as unknown as Engine);

  await expect(waitForGpsTrack('a1')).resolves.toEqual([
    [-37.8, 144.9],
    [-37.81, 144.91],
  ]);
  expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);
  expect(engine.subscribe).not.toHaveBeenCalled();
});

it('makes no engine call between the request and the announcement', async () => {
  const engine = fakeEngine(null);
  mockGetEngine.mockReturnValue(engine as unknown as Engine);

  const pending = waitForGpsTrack('a1');
  await flush();
  expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(10_000);
  await flush();
  expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);

  engine.store(points);
  engine.announce('gpsTrackStored', { activityId: 'a1' });

  await expect(pending).resolves.toEqual([
    [-37.8, 144.9],
    [-37.81, 144.91],
  ]);
  expect(engine.getGpsTrack).toHaveBeenCalledTimes(2);
});

it('ignores an announcement for another activity', async () => {
  const engine = fakeEngine(null);
  mockGetEngine.mockReturnValue(engine as unknown as Engine);

  const pending = waitForGpsTrack('a1');
  await flush();

  engine.store(points);
  engine.announce('gpsTrackStored', { activityId: 'a2' });
  await flush();
  expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);

  engine.announce('gpsTrackStored', { activityId: 'a1' });
  await expect(pending).resolves.toHaveLength(2);
});

it('keeps waiting when the announced track reads back empty', async () => {
  const engine = fakeEngine(null);
  mockGetEngine.mockReturnValue(engine as unknown as Engine);

  const pending = waitForGpsTrack('a1');
  await flush();

  engine.announce('gpsTrackStored', { activityId: 'a1' });
  await flush();

  engine.store(points);
  engine.announce('gpsTrackStored', { activityId: 'a1' });
  await expect(pending).resolves.toHaveLength(2);
});

it('gives up after the timeout and drops its subscription', async () => {
  const engine = fakeEngine(null);
  mockGetEngine.mockReturnValue(engine as unknown as Engine);

  const pending = waitForGpsTrack('a1');
  await flush();

  jest.advanceTimersByTime(15_000);
  await expect(pending).resolves.toBeNull();

  const live = [...engine.listeners.values()].reduce((n, set) => n + set.size, 0);
  expect(live).toBe(0);
});

it('drops its subscription once the track lands', async () => {
  const engine = fakeEngine(null);
  mockGetEngine.mockReturnValue(engine as unknown as Engine);

  const pending = waitForGpsTrack('a1');
  await flush();
  engine.store(points);
  engine.announce('gpsTrackStored', { activityId: 'a1' });
  await pending;

  const live = [...engine.listeners.values()].reduce((n, set) => n + set.size, 0);
  expect(live).toBe(0);
});

it('answers null when there is no engine', async () => {
  mockGetEngine.mockReturnValue(null);

  await expect(waitForGpsTrack('a1')).resolves.toBeNull();
});
