/**
 * Scenario: the GPS download's store thread dies. The poll sees the download
 * go inactive, the engine holds no result, and the run returns having stored
 * nothing.
 *
 * Expected behaviour: the run writes a terminal status on its way out. The
 * last `fetching` otherwise stands on the map banner, the settings range
 * panel and the routes list spinner until the next sync replaces it, which is
 * the next foreground or reconnect at the earliest.
 */
import { endGpsSync, type GpsSyncEnding } from '@/features/routes/lib/gpsSyncEnding';
import type { SyncProgress } from '@/features/routes/hooks/useRouteSyncProgress';

const ENDINGS: GpsSyncEnding[] = ['no-result', 'no-engine', 'cancelled', 'superseded'];

function end(ending: GpsSyncEnding, over: Partial<Parameters<typeof endGpsSync>[1]> = {}) {
  const written: SyncProgress[] = [];
  const result = endGpsSync(ending, {
    updateProgress: (next) => written.push(next as SyncProgress),
    isMounted: true,
    withGpsCount: 12,
    ...over,
  });
  return { written, result };
}

describe('a GPS download run that stores nothing', () => {
  it.each(ENDINGS)('leaves no running status behind on %s', (ending) => {
    const { written } = end(ending);

    expect(written).toHaveLength(1);
    expect(['fetching', 'processing', 'computing']).not.toContain(written[0].status);
  });

  it.each(ENDINGS)('says why, so the ending is readable on %s', (ending) => {
    const { written, result } = end(ending);

    expect(written[0].message).not.toBe('');
    expect(result.message).toBe(written[0].message);
  });

  it('calls a dead worker an error, because nothing was stored and nobody asked', () => {
    expect(end('no-result').written[0].status).toBe('error');
    expect(end('no-engine').written[0].status).toBe('error');
  });

  it('calls a cancelled or superseded run idle, because neither is a failure', () => {
    expect(end('cancelled').written[0].status).toBe('idle');
    expect(end('superseded').written[0].status).toBe('idle');
  });

  it('reports nothing synced, whatever the run was asked for', () => {
    const { result } = end('no-result');

    expect(result.syncedIds).toEqual([]);
    expect(result.withGpsCount).toBe(12);
  });

  it('keeps a superseded run from counting activities a newer sync now owns', () => {
    expect(end('superseded').result.withGpsCount).toBe(0);
  });

  it('writes nothing once the screen is gone, and still returns', () => {
    const { written, result } = end('no-result', { isMounted: false });

    expect(written).toHaveLength(0);
    expect(result.syncedIds).toEqual([]);
  });
});
