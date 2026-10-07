/**
 * Scenario: a record the engine hands back is persisted whole. A TanStack
 * `placeholderData`, a widget snapshot, a crash-report payload: each one runs
 * the object through `JSON.stringify`.
 *
 * Expected behaviour: it does not throw. A field lifted as `bigint` makes
 * `JSON.stringify` raise `Do not know how to serialize a BigInt`, and `tsc`
 * cannot see it, so the first caller to persist one fails in release on every
 * launch. Every timestamp, duration, rowid, version and byte count crosses as
 * an `f64` instead, which is exact to 2^53. That no generated record field is
 * a `bigint` is `lint:ffi-bigint`.
 */

describe('a record the engine hands back', () => {
  /** One of each shape the sweep touched, with the fields it converted. */
  const records = {
    activityMetrics: { activityId: 'a1', name: 'Ride', date: 1_768_435_200, distance: 30_000 },
    periodStats: { count: 3, totalDuration: 5_400, totalDistance: 30_000, totalTss: 120 },
    weeklySummary: { weekStart: 1_768_435_200, count: 3, movingTime: 5_400, distance: 30_000 },
    recordingEntry: {
      id: 'r1',
      startTime: 1_768_435_200_000,
      durationSeconds: 3_600,
      createdAt: 1_768_439_000_000,
      pairedEventId: 42,
      lastAttemptAt: 1_768_440_000_000,
    },
    sectionHistoryEvent: { id: 7, geometryVersion: 3 },
    heatmapDay: { date: 1_768_435_200, maxDuration: 5_400 },
    retiredSection: {
      sectionId: 's1',
      kind: 'merged',
      at: '2026-01-01',
      into: 's2',
      versions: [1, 2, 3],
    },
    exportResult: { totalBytes: 9_000_000 },
  };

  it.each(Object.entries(records))('serialises %s', (_name, record) => {
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  /** The failing case, stated the other way round, so the assertion above is
   *  known to be measuring something. */
  it('throws when one of those fields is a bigint', () => {
    expect(() => JSON.stringify({ ...records.periodStats, totalDuration: BigInt(5_400) })).toThrow(
      /BigInt/
    );
  });
});
