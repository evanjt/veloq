/**
 * Scenario: a silent-push ingest leaves an activity id behind, the feed drains
 * the list on mount, and the ids go into a priority set nothing reads.
 *
 * Expected behaviour: previews are rendered on demand with no build-ahead pass,
 * so there is no background job for the pending list to seed. The set, its two
 * readers and the listener that was never assigned are gone, and mounting the
 * pool early is all the list does.
 *
 * A static check, because the defect is that the path is unreachable: nothing
 * calling it can fail, which is why it survived three passes over this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

function source(relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

const CACHE = 'features/maps/lib/storage/terrainPreviewCache.ts';
const FEED = 'app/(tabs)/index.tsx';
const CARD = 'features/activity/components/ActivityMapPreview.tsx';

describe('the decorative snapshot priority path', () => {
  it.each([
    'prioritySnapshotIds',
    'setPrioritySnapshotIds',
    'isPrioritySnapshot',
    'clearPrioritySnapshot',
    'snapshotNeededListener',
    'signalSnapshotNeeded',
  ])('has no %s left in the cache module', (symbol) => {
    expect(source(CACHE)).not.toContain(symbol);
  });

  it.each([FEED, CARD])('is not referenced from %s', (file) => {
    const text = source(file);
    expect(text).not.toContain('PrioritySnapshot');
    expect(text).not.toContain('signalSnapshotNeeded');
  });

  it('keeps the pending list, which is what mounts the pool early', () => {
    expect(source(CACHE)).toContain('addPendingSnapshot');
    expect(source(CACHE)).toContain('consumePendingSnapshots');
    expect(source(FEED)).toContain('setSnapshotWebViewReady(true)');
  });

  it('keeps the one priority the queue actually honours, the card override', () => {
    // The queue has one real lane. It is fed by an athlete changing one card's
    // map, never by the pending list, and that is the lane that stays.
    expect(source(CARD)).toContain('priority: hasActivityOverride(activity.id)');
  });
});
