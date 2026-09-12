/**
 * Scenario: Settings opened with no network, so no snapshot worker has ever
 * resolved a style and none has reached `mapReady`.
 *
 * Expected behaviour: a worker whose document has loaded still answers, because
 * the cache the stats read lives in the document and not in the map.
 */
import { pickStatsWorker } from '@/features/maps/lib/tileCacheStatsWorker';

describe('pickStatsWorker', () => {
  it('picks a worker whose document has loaded, with no map', () => {
    const worker = { documentReady: true, hasView: true, id: 0 };
    expect(pickStatsWorker([worker])).toBe(worker);
  });

  it('skips a worker whose document has not loaded', () => {
    expect(pickStatsWorker([{ documentReady: false, hasView: true }])).toBeNull();
  });

  it('skips a worker whose WebView is gone', () => {
    expect(pickStatsWorker([{ documentReady: true, hasView: false }])).toBeNull();
  });

  it('falls through to a later worker when the first is not ready', () => {
    const second = { documentReady: true, hasView: true, id: 1 };
    expect(pickStatsWorker([{ documentReady: false, hasView: true, id: 0 }, second])).toBe(second);
  });

  it('picks one worker, not every ready worker', () => {
    const first = { documentReady: true, hasView: true, id: 0 };
    const second = { documentReady: true, hasView: true, id: 1 };
    expect(pickStatsWorker([first, second])).toBe(first);
  });

  it('answers null when the pool is empty', () => {
    expect(pickStatsWorker([])).toBeNull();
  });
});
