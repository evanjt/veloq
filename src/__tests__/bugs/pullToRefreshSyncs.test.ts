/**
 * Static regression for B31. Pull-to-refresh on home, fitness and training only
 * invalidated queries whose `queryFn` reads SQLite, so the gesture redrew what
 * the last sync wrote and never reached intervals.icu. Each handler has to ask
 * the engine for a sync as well.
 *
 * The reconnect edge is guarded here too: an effect keyed on a ref object runs
 * once at mount, because a ref's identity never changes.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

const REFRESH_HANDLERS = [
  'app/(tabs)/index.tsx',
  'app/(tabs)/training.tsx',
  'features/fitness/hooks/useFitnessRefresh.ts',
];

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('B31: pull-to-refresh reaches the network', () => {
  it.each(REFRESH_HANDLERS)('%s imports requestSyncRefresh', (relative) => {
    expect(read(relative)).toMatch(
      /import\s+\{[^}]*\brequestSyncRefresh\b[^}]*\}\s+from\s+['"][^'"]*syncRefresh['"]/
    );
  });

  it.each(REFRESH_HANDLERS)('%s calls requestSyncRefresh', (relative) => {
    expect(read(relative)).toMatch(/requestSyncRefresh\(\)/);
  });
});

describe('B31: the route-sync reconnect effect is keyed on a value', () => {
  it('useRouteDataSync no longer depends on a ref object for the edge', () => {
    expect(read('features/routes/hooks/useRouteDataSync.ts')).not.toMatch(/\}, \[isOnlineRef\]\);/);
  });
});
