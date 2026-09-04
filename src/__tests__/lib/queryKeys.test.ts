/**
 * Scenario: the sync tree and the map tab read the same activity window.
 * Expected behaviour: they land on one cache entry, because the key carries
 * only what the read is keyed on and nothing the read ignores.
 */

import { queryKeys } from '@/shared/query/queryKeys';

describe('activity query keys', () => {
  it('keys the window on the athlete and the range alone', () => {
    expect(queryKeys.activities.list('i1', '2026-01-01', '2026-03-31')).toEqual([
      'activities',
      'i1',
      '2026-01-01',
      '2026-03-31',
    ]);
  });

  it('gives the same key to two readers of one window', () => {
    expect(queryKeys.activities.list('i1', '2026-01-01', '2026-03-31')).toEqual(
      queryKeys.activities.list('i1', '2026-01-01', '2026-03-31')
    );
  });

  it('keeps distinct ranges and athletes apart', () => {
    const range = queryKeys.activities.list('i1', '2026-01-01', '2026-03-31');
    expect(queryKeys.activities.list('i1', '2026-02-01', '2026-03-31')).not.toEqual(range);
    expect(queryKeys.activities.list('i2', '2026-01-01', '2026-03-31')).not.toEqual(range);
  });

  it('keys the feed on the athlete alone', () => {
    expect(queryKeys.activities.infinite.byAthlete('i1')).toEqual(['activities-infinite', 'i1']);
    expect(queryKeys.activities.infinite.byAthlete('i2')).not.toEqual(
      queryKeys.activities.infinite.byAthlete('i1')
    );
  });

  it('matches the partial key used to invalidate every window', () => {
    expect(queryKeys.activities.list('i1', '2026-01-01', '2026-03-31').slice(0, 1)).toEqual(
      queryKeys.activities.all
    );
    expect(queryKeys.activities.infinite.byAthlete('i1').slice(0, 1)).toEqual(
      queryKeys.activities.infinite.all
    );
  });
});
