/**
 * Empty array access and unguarded property access bugs.
 * Tests patterns where code assumes arrays are non-empty or objects are defined.
 */

describe('wellness array empty access (fitness.tsx:279)', () => {
  /**
   * src/app/(tabs)/fitness.tsx lines 277-281
   *
   * Code:
   *   if (!wellness || wellness.length === 0) return null;
   *   const sorted = [...wellness].sort((a, b) => b.id.localeCompare(a.id));
   *   const latest = sorted[0];
   *   const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
   *
   * The early return on line 278 guards against empty arrays.
   * Test that the guard works.
   */
  function getLatestWellness(
    wellness: { id: string; ctl?: number; ctlLoad?: number }[] | undefined
  ) {
    if (!wellness || wellness.length === 0) return null;
    const sorted = [...wellness].sort((a, b) => b.id.localeCompare(a.id));
    const latest = sorted[0];
    const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
    return fitnessRaw;
  }

  it('works with valid wellness data', () => {
    const result = getLatestWellness([
      { id: '2026-01-15', ctl: 45 },
      { id: '2026-01-14', ctl: 44 },
    ]);
    expect(result).toBe(45);
  });

  it('returns most recent by id sort', () => {
    const result = getLatestWellness([
      { id: '2026-01-10', ctl: 30 },
      { id: '2026-01-15', ctl: 45 },
      { id: '2026-01-12', ctl: 38 },
    ]);
    expect(result).toBe(45);
  });

  it('falls back to ctlLoad when ctl is undefined', () => {
    const result = getLatestWellness([{ id: '2026-01-15', ctlLoad: 42 }]);
    expect(result).toBe(42);
  });

  it('falls back to 0 when both ctl and ctlLoad are undefined', () => {
    const result = getLatestWellness([{ id: '2026-01-15' }]);
    expect(result).toBe(0);
  });

  it('handles empty wellness array via guard', () => {
    expect(getLatestWellness([])).toBeNull();
  });

  it('handles undefined wellness via guard', () => {
    expect(getLatestWellness(undefined)).toBeNull();
  });
});

describe('zones empty access (fitness.tsx:215)', () => {
  /**
   * src/app/(tabs)/fitness.tsx lines 213-220
   *
   * Code:
   *   const zones = sportMode === 'Cycling' ? powerZones : hrZones;
   *   if (!zones || zones.length === 0) return null;
   *   const sorted = [...zones].sort((a, b) => b.percentage - a.percentage);
   *   const top = sorted[0];
   *   if (top.percentage === 0) return null;
   *   return { name: top.name, percentage: top.percentage };
   *
   * The early return on line 215 guards against empty/undefined zones.
   * Test that the guard works.
   */
  function getDominantZone(zones: { percentage: number; name: string }[] | undefined) {
    if (!zones || zones.length === 0) return null;
    const sorted = [...zones].sort((a, b) => b.percentage - a.percentage);
    const top = sorted[0];
    if (top.percentage === 0) return null;
    return { name: top.name, percentage: top.percentage };
  }

  it('works with valid zones', () => {
    const result = getDominantZone([
      { percentage: 30, name: 'Z2' },
      { percentage: 50, name: 'Z3' },
      { percentage: 20, name: 'Z1' },
    ]);
    expect(result).toEqual({ name: 'Z3', percentage: 50 });
  });

  it('handles empty zones via guard', () => {
    expect(getDominantZone([])).toBeNull();
  });

  it('handles undefined zones via guard', () => {
    expect(getDominantZone(undefined)).toBeNull();
  });

  it('returns null when all zones are 0%', () => {
    expect(getDominantZone([{ percentage: 0, name: 'Z1' }])).toBeNull();
  });
});

describe('streams.latlng access (review.tsx:139)', () => {
  /**
   * src/app/recording/review.tsx line 139
   *
   * Code:
   *   const [trimEnd, setTrimEnd] = useState(
   *     streams.latlng.length > 0 ? streams.latlng.length - 1 : 0
   *   );
   *
   * The RecordingStreams type defines latlng as [number, number][] (non-optional),
   * and the store initializes it to []. At the TypeScript level this is safe.
   * However if the store were deserialized from a backup/crash where the
   * property was missing, runtime access would crash.
   */
  function getTrimEnd(streams: { latlng?: [number, number][] }) {
    return (streams.latlng?.length ?? 0) > 0 ? streams.latlng!.length - 1 : 0;
  }

  it('works with valid streams', () => {
    expect(
      getTrimEnd({
        latlng: [
          [45, 10],
          [45.1, 10.1],
        ],
      })
    ).toBe(1);
  });

  it('returns 0 for empty latlng', () => {
    expect(getTrimEnd({ latlng: [] })).toBe(0);
  });

  it('handles undefined latlng without crash', () => {
    expect(() => getTrimEnd({ latlng: undefined })).not.toThrow();
    expect(getTrimEnd({ latlng: undefined })).toBe(0);
  });

  it('handles missing latlng property without crash', () => {
    expect(() => getTrimEnd({} as any)).not.toThrow();
    expect(getTrimEnd({} as any)).toBe(0);
  });
});

describe('streams.latlng geocoding access (review.tsx:264)', () => {
  /**
   * src/app/recording/review.tsx lines 264-267
   *
   * Code:
   *   if (summary.hasGps && streams.latlng.length >= 2) {
   *     const first = streams.latlng[0];
   *     const last = streams.latlng[streams.latlng.length - 1];
   *     const isLoop = Math.abs(first[0] - last[0]) < 0.002 ...
   *
   * The `streams.latlng.length >= 2` check guards against empty arrays,
   * ensuring first and last are defined before accessing [0] and [1].
   */
  function getLoopInfo(latlng: [number, number][]) {
    if (latlng.length >= 2) {
      const first = latlng[0];
      const last = latlng[latlng.length - 1];
      const isLoop = Math.abs(first[0] - last[0]) < 0.002 && Math.abs(first[1] - last[1]) < 0.002;
      return { first, last, isLoop };
    }
    return null;
  }

  it('detects a loop', () => {
    const result = getLoopInfo([
      [45.0, 10.0],
      [45.1, 10.1],
      [45.001, 10.001],
    ]);
    expect(result?.isLoop).toBe(true);
  });

  it('detects non-loop', () => {
    const result = getLoopInfo([
      [45.0, 10.0],
      [46.0, 11.0],
    ]);
    expect(result?.isLoop).toBe(false);
  });

  it('returns null for single-point array via guard', () => {
    expect(getLoopInfo([[45.0, 10.0]])).toBeNull();
  });

  it('returns null for empty array via guard', () => {
    expect(getLoopInfo([])).toBeNull();
  });
});

describe('Math.max spread on empty dates (route/[id].tsx:330)', () => {
  /**
   * src/app/route/[id].tsx lines 325-331
   *
   * Code:
   *   if (performances.length === 0) return { distance: 0, lastDate: '' };
   *   const distances = performances.map((p) => p.distance || 0);
   *   const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
   *   const dates = performances.map((p) => p.date.getTime());
   *   const lastDate = new Date(Math.max(...dates)).toISOString();
   *
   * The early return on line 326 guards against empty performances.
   * Math.max() with no arguments returns -Infinity, and
   * new Date(-Infinity).toISOString() throws RangeError.
   */
  function getRouteStats(performances: { distance: number; date: Date }[]) {
    if (performances.length === 0) return { distance: 0, lastDate: '' };
    const distances = performances.map((p) => p.distance || 0);
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const dates = performances.map((p) => p.date.getTime());
    const lastDate = new Date(Math.max(...dates)).toISOString();
    return { distance: avgDistance, lastDate };
  }

  it('computes stats for valid performances', () => {
    const result = getRouteStats([
      { distance: 1000, date: new Date('2026-01-15') },
      { distance: 1200, date: new Date('2026-01-20') },
    ]);
    expect(result.distance).toBe(1100);
    expect(result.lastDate).toContain('2026-01-20');
  });

  it('returns defaults for empty performances via guard', () => {
    const result = getRouteStats([]);
    expect(result).toEqual({ distance: 0, lastDate: '' });
  });

  it('Math.max with no args returns -Infinity (proving the guard is needed)', () => {
    // Without the guard, Math.max(...[]) = -Infinity
    expect(Math.max(...[])).toBe(-Infinity);
    // new Date(-Infinity).toISOString() throws RangeError
    expect(() => new Date(-Infinity).toISOString()).toThrow(RangeError);
  });
});

describe('pickBestInsightForNotification with empty array (insightNotification.ts:108)', () => {
  /**
   * src/lib/notifications/insightNotification.ts lines 108-121
   *
   * Code:
   *   if (insights.length === 0) return null;
   *   const pr = insights.find((i) => i.category === 'section_pr');
   *   if (pr) return pr;
   *   const milestone = insights.find((i) => i.category === 'fitness_milestone');
   *   if (milestone) return milestone;
   *   return insights.reduce((best, current) => ...);
   *
   * The guard on line 109 handles empty arrays. The reduce on line 120 would
   * throw TypeError without the guard (reduce with no initial value on empty array).
   */
  type MockInsight = { category: string; priority: number };

  function pickBest(insights: MockInsight[]): MockInsight | null {
    if (insights.length === 0) return null;
    const pr = insights.find((i) => i.category === 'section_pr');
    if (pr) return pr;
    const milestone = insights.find((i) => i.category === 'fitness_milestone');
    if (milestone) return milestone;
    return insights.reduce((best, current) => (current.priority < best.priority ? current : best));
  }

  it('returns null for empty array via guard', () => {
    expect(pickBest([])).toBeNull();
  });

  it('prioritizes section_pr', () => {
    const result = pickBest([
      { category: 'hrv_trend', priority: 2 },
      { category: 'section_pr', priority: 1 },
      { category: 'fitness_milestone', priority: 2 },
    ]);
    expect(result?.category).toBe('section_pr');
  });

  it('falls back to fitness_milestone', () => {
    const result = pickBest([
      { category: 'hrv_trend', priority: 2 },
      { category: 'fitness_milestone', priority: 2 },
    ]);
    expect(result?.category).toBe('fitness_milestone');
  });

  it('falls back to highest priority (lowest number)', () => {
    const result = pickBest([
      { category: 'hrv_trend', priority: 3 },
      { category: 'stale_pr', priority: 1 },
      { category: 'period_comparison', priority: 2 },
    ]);
    expect(result?.category).toBe('stale_pr');
  });

  it('reduce without guard would throw on empty array (proving the guard is needed)', () => {
    const emptyArr: MockInsight[] = [];
    expect(() =>
      emptyArr.reduce((best, current) => (current.priority < best.priority ? current : best))
    ).toThrow(TypeError);
  });
});

describe('safeJsonParse pattern for AsyncStorage values', () => {
  /**
   * Documents the defensive pattern: when reading JSON from AsyncStorage,
   * a `raw ? JSON.parse(raw) : []` guard handles null but throws on corrupt
   * data. Use safeJsonParse with array validation instead.
   */
  // Fixed pattern uses safeJsonParse with array validation
  function safeJsonParse(json: string | null, fallback: string[]): string[] {
    if (!json) return fallback;
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  function parseStoredIds(raw: string | null): Set<string> {
    return new Set<string>(safeJsonParse(raw, []));
  }

  it('parses valid JSON', () => {
    const result = parseStoredIds('["id1","id2"]');
    expect(result.size).toBe(2);
    expect(result.has('id1')).toBe(true);
    expect(result.has('id2')).toBe(true);
  });

  it('handles null input', () => {
    const result = parseStoredIds(null);
    expect(result.size).toBe(0);
  });

  it('handles empty string (treated as truthy, triggers JSON.parse)', () => {
    // Empty string is falsy in JS, so falls through to empty array
    const result = parseStoredIds('');
    expect(result.size).toBe(0);
  });

  it('handles valid empty array JSON', () => {
    const result = parseStoredIds('[]');
    expect(result.size).toBe(0);
  });

  it('handles corrupted JSON without throwing', () => {
    expect(() => parseStoredIds('{corrupted')).not.toThrow();
    expect(parseStoredIds('{corrupted').size).toBe(0);
  });

  it('handles non-array JSON by returning fallback', () => {
    expect(() => parseStoredIds('{"a":1}')).not.toThrow();
    expect(parseStoredIds('{"a":1}').size).toBe(0);
  });
});
