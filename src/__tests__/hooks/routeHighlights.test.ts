/**
 * Tests for route highlight PR and trend logic.
 * Validates the display conditions used by ActivityCard for route badges.
 */

describe('Route highlight display logic', () => {
  // ActivityCard renders badge when: routeHighlight.trend !== 0 || routeHighlight.isPr
  const shouldShowBadge = (h: { isPr: boolean; trend: number }) => h.trend !== 0 || h.isPr;

  it('shows badge for PR with positive trend', () => {
    expect(shouldShowBadge({ isPr: true, trend: 1 })).toBe(true);
  });

  it('shows badge for PR with zero trend (first traversal)', () => {
    // A PR can have trend=0 if it's the first or second attempt
    expect(shouldShowBadge({ isPr: true, trend: 0 })).toBe(true);
  });

  it('shows badge for improving trend without PR', () => {
    expect(shouldShowBadge({ isPr: false, trend: 1 })).toBe(true);
  });

  it('shows badge for declining trend without PR', () => {
    expect(shouldShowBadge({ isPr: false, trend: -1 })).toBe(true);
  });

  it('hides badge for neutral trend without PR', () => {
    expect(shouldShowBadge({ isPr: false, trend: 0 })).toBe(false);
  });
});

describe('Route PR determination', () => {
  // Simulates the Rust logic: MIN(moving_time) within 0.5s tolerance
  function computeRouteHighlights(
    members: Array<{ id: string; movingTime: number; date: number }>
  ) {
    if (members.length < 2) return [];

    const sorted = [...members].sort((a, b) => a.date - b.date);
    const best = Math.min(...sorted.map((m) => m.movingTime));

    let sum = 0;
    let count = 0;
    return sorted.map((m) => {
      const trend =
        count === 0
          ? 0
          : m.movingTime < (sum / count) * 0.99
            ? 1
            : m.movingTime > (sum / count) * 1.01
              ? -1
              : 0;
      sum += m.movingTime;
      count++;
      return {
        activityId: m.id,
        isPr: Math.abs(m.movingTime - best) < 0.5,
        trend,
      };
    });
  }

  it('marks fastest activity as PR', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1800, date: 1 },
      { id: 'a2', movingTime: 1700, date: 2 },
    ]);
    expect(results[0].isPr).toBe(false); // a1: 1800 != 1700
    expect(results[1].isPr).toBe(true); // a2: 1700 is MIN
  });

  it('marks first activity as PR when it is fastest', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1700, date: 1 },
      { id: 'a2', movingTime: 1800, date: 2 },
    ]);
    expect(results[0].isPr).toBe(true); // a1: 1700 is MIN
    expect(results[1].isPr).toBe(false);
  });

  it('returns empty for singleton routes', () => {
    expect(computeRouteHighlights([{ id: 'a1', movingTime: 1800, date: 1 }])).toEqual([]);
  });

  it('marks both as PR for equal times', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1800, date: 1 },
      { id: 'a2', movingTime: 1800, date: 2 },
    ]);
    expect(results[0].isPr).toBe(true);
    expect(results[1].isPr).toBe(true);
  });

  it('assigns improving trend when >1% faster than average', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1000, date: 1 },
      { id: 'a2', movingTime: 985, date: 2 }, // 1.5% faster
    ]);
    expect(results[1].trend).toBe(1);
  });

  it('assigns declining trend when >1% slower than average', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1000, date: 1 },
      { id: 'a2', movingTime: 1015, date: 2 }, // 1.5% slower
    ]);
    expect(results[1].trend).toBe(-1);
  });

  it('assigns neutral trend when within 1% of average', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1000, date: 1 },
      { id: 'a2', movingTime: 1005, date: 2 }, // 0.5% slower
    ]);
    expect(results[1].trend).toBe(0);
  });

  it('first activity always has trend=0', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 1000, date: 1 },
      { id: 'a2', movingTime: 900, date: 2 },
    ]);
    expect(results[0].trend).toBe(0);
  });

  it('handles 7 activities with last being fastest', () => {
    const results = computeRouteHighlights([
      { id: 'a1', movingTime: 2000, date: 1 },
      { id: 'a2', movingTime: 1950, date: 2 },
      { id: 'a3', movingTime: 1900, date: 3 },
      { id: 'a4', movingTime: 1850, date: 4 },
      { id: 'a5', movingTime: 1800, date: 5 },
      { id: 'a6', movingTime: 1780, date: 6 },
      { id: 'a7', movingTime: 1700, date: 7 },
    ]);
    // Last is fastest
    expect(results[6].isPr).toBe(true);
    expect(results[6].trend).toBe(1);
    // Others are not PR
    for (let i = 0; i < 6; i++) {
      expect(results[i].isPr).toBe(false);
    }
  });
});
