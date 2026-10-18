/**
 * Scenario: the worker page captured a render whose tiles were still loading
 * once five seconds had passed, captured a turned camera after two and a half
 * whatever had arrived, and captured over one failed tile. MapLibre counts an
 * errored tile as loaded, so a failure reaches the page only as an error event.
 * A posted `snapshot` is saved as final and never asked for again.
 *
 * Expected behaviour: the page posts `snapshot` only for a render whose style
 * has loaded with no counted tile error, and anything less is a
 * `snapshotError`, which the host retries.
 */

import { bootWorkerPage } from '../__shared__/snapshotWorkerPage';
import type { WorkerPage } from '../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';

const camera: TerrainCamera = { center: [8.55, 47.45], zoom: 12, bearing: 0, pitch: 60 };

const request = (activityId = 'ride-dark'): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.5, 47.4],
    [8.6, 47.5],
  ],
  camera,
  cameraPinned: true,
  mapStyle: 'dark',
});

const tileError = (sourceId: string, status: number) => ({
  sourceId,
  error: { status, message: status === 0 ? 'Failed to fetch' : `HTTP ${status}` },
});

const results = (page: WorkerPage) =>
  page.posted.filter((m) => m.type === 'snapshot' || m.type === 'snapshotError');

/** A first render that loads, so the next one on the same style takes the fast path. */
function warmFastPath(page: WorkerPage) {
  page.render(request('ride-first'), 1);
  jest.advanceTimersByTime(400);
  expect(results(page)).toEqual([expect.objectContaining({ type: 'snapshot', gen: 1 })]);
  page.map.getSource.mockImplementation((id: string) => (id === 'terrain' ? {} : null));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('a render still loading', () => {
  it('is not captured at five seconds and fails at the hard timeout', () => {
    const page = bootWorkerPage();
    page.map.isStyleLoaded.mockReturnValue(false);

    page.render(request(), 1);
    jest.advanceTimersByTime(5400);
    expect(results(page)).toEqual([]);

    jest.advanceTimersByTime(700);
    expect(results(page)).toEqual([expect.objectContaining({ type: 'snapshotError', gen: 1 })]);
  });

  it('fails on the fast path rather than being captured', () => {
    const page = bootWorkerPage();
    warmFastPath(page);
    page.map.isStyleLoaded.mockReturnValue(false);

    page.render(request(), 2);
    jest.advanceTimersByTime(6100);

    const second = results(page).slice(1);
    expect(second).toEqual([expect.objectContaining({ type: 'snapshotError', gen: 2 })]);
  });

  it('fails at the render deadline after a turned camera whose new tiles never arrive', () => {
    const page = bootWorkerPage();
    const turned: TerrainCamera = { ...camera, bearing: 180 };
    page.window._pickUnhiddenCamera = () => {
      page.map.isStyleLoaded.mockReturnValue(false);
      return turned;
    };

    page.render({ ...request(), cameraPinned: false }, 1);
    jest.advanceTimersByTime(200);
    expect(page.map.jumpTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ bearing: turned.bearing })
    );
    jest.advanceTimersByTime(5200);
    expect(results(page)).toEqual([]);

    jest.advanceTimersByTime(700);
    expect(results(page)).toEqual([expect.objectContaining({ type: 'snapshotError', gen: 1 })]);
  });

  it('is captured once a turned camera has loaded', () => {
    const page = bootWorkerPage();
    page.window._pickUnhiddenCamera = () => {
      page.map.isStyleLoaded.mockReturnValue(false);
      setTimeout(() => page.map.isStyleLoaded.mockReturnValue(true), 3000);
      return { ...camera, bearing: 180 };
    };

    page.render({ ...request(), cameraPinned: false }, 1);
    jest.advanceTimersByTime(3600);

    expect(results(page)).toEqual([expect.objectContaining({ type: 'snapshot', gen: 1 })]);
  });
});

describe('a render with a failed tile', () => {
  it('fails on one network error from the vector source', () => {
    const page = bootWorkerPage();

    page.render(request(), 1);
    page.map.emit('error', tileError('openmaptiles', 0));
    jest.advanceTimersByTime(400);

    expect(results(page)).toEqual([
      expect.objectContaining({ type: 'snapshotError', gen: 1, tileErrors: 1 }),
    ]);
  });

  it('fails on one failed tile on the fast path', () => {
    const page = bootWorkerPage();
    warmFastPath(page);

    page.render(request(), 2);
    page.map.emit('error', tileError('terrain', 502));
    jest.advanceTimersByTime(400);

    expect(results(page).slice(1)).toEqual([
      expect.objectContaining({ type: 'snapshotError', gen: 2, tileErrors: 1 }),
    ]);
  });

  it.each(['terrain', 'openmaptiles', 'satellite-eox'])('fails on a 404 from %s', (sourceId) => {
    const page = bootWorkerPage();

    page.render(request(), 1);
    page.map.emit('error', tileError(sourceId, 404));
    jest.advanceTimersByTime(400);

    expect(results(page)).toEqual([
      expect.objectContaining({ type: 'snapshotError', gen: 1, tileErrors: 1 }),
    ]);
  });

  it.each(['satellite-spain', 'satellite-swisstopo-2'])(
    'is captured over a 404 from the regional source %s, which is out of coverage',
    (sourceId) => {
      const page = bootWorkerPage();

      page.render(request(), 1);
      page.map.emit('error', tileError(sourceId, 404));
      jest.advanceTimersByTime(400);

      expect(results(page)).toEqual([
        expect.objectContaining({ type: 'snapshot', gen: 1, tileErrors: 0 }),
      ]);
    }
  );
});

it('captures a render that loaded with no error', () => {
  const page = bootWorkerPage();

  page.render(request(), 1);
  jest.advanceTimersByTime(400);

  expect(results(page)).toEqual([
    expect.objectContaining({ type: 'snapshot', gen: 1, tileErrors: 0, tileThrottles: 0 }),
  ]);
});
