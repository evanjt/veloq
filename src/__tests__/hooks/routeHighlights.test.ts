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

describe('Route PR determination (speed-based)', () => {
  // Simulates the Rust logic: MAX(speed) where speed = distance / moving_time
  // PR = highest speed (fastest pace), matching the route detail page
  function computeRouteHighlights(
    members: Array<{ id: string; distance: number; movingTime: number; date: number }>
  ) {
    if (members.length < 2) return [];

    const sorted = [...members].sort((a, b) => a.date - b.date);
    const speeds = sorted.map((m) => m.distance / m.movingTime);
    const best = Math.max(...speeds);

    let sum = 0;
    let count = 0;
    return sorted.map((m, i) => {
      const speed = speeds[i];
      // Trend: higher speed = improving
      const trend =
        count === 0 ? 0 : speed > (sum / count) * 1.01 ? 1 : speed < (sum / count) * 0.99 ? -1 : 0;
      sum += speed;
      count++;
      return {
        activityId: m.id,
        isPr: Math.abs(speed - best) / best < 0.005,
        trend,
      };
    });
  }

  it('marks highest-speed activity as PR (same distance)', () => {
    const results = computeRouteHighlights([
      { id: 'a1', distance: 5000, movingTime: 1800, date: 1 },
      { id: 'a2', distance: 5000, movingTime: 1700, date: 2 },
    ]);
    expect(results[0].isPr).toBe(false);
    expect(results[1].isPr).toBe(true); // faster time = higher speed
  });

  it('marks longer-distance run as PR when speed is higher', () => {
    // Real-world case: 26 Mar (4.4km/29:22) vs 15 Mar (4.3km/29:09)
    const results = computeRouteHighlights([
      { id: 'mar15', distance: 4300, movingTime: 1749, date: 1 }, // speed = 2.459 m/s
      { id: 'mar26', distance: 4400, movingTime: 1762, date: 2 }, // speed = 2.497 m/s
    ]);
    expect(results[0].isPr).toBe(false); // 15 Mar: faster time but slower pace
    expect(results[1].isPr).toBe(true); // 26 Mar: higher speed = PR
  });

  it('returns empty for singleton routes', () => {
    expect(
      computeRouteHighlights([{ id: 'a1', distance: 5000, movingTime: 1800, date: 1 }])
    ).toEqual([]);
  });

  it('marks both as PR for equal speeds', () => {
    const results = computeRouteHighlights([
      { id: 'a1', distance: 5000, movingTime: 1800, date: 1 },
      { id: 'a2', distance: 5000, movingTime: 1800, date: 2 },
    ]);
    expect(results[0].isPr).toBe(true);
    expect(results[1].isPr).toBe(true);
  });

  it('assigns improving trend when speed >1% above average', () => {
    const results = computeRouteHighlights([
      { id: 'a1', distance: 5000, movingTime: 1000, date: 1 }, // 5.0 m/s
      { id: 'a2', distance: 5000, movingTime: 980, date: 2 }, // 5.10 m/s (2% faster)
    ]);
    expect(results[1].trend).toBe(1);
  });

  it('assigns declining trend when speed >1% below average', () => {
    const results = computeRouteHighlights([
      { id: 'a1', distance: 5000, movingTime: 1000, date: 1 }, // 5.0 m/s
      { id: 'a2', distance: 5000, movingTime: 1020, date: 2 }, // 4.90 m/s (2% slower)
    ]);
    expect(results[1].trend).toBe(-1);
  });

  it('first activity always has trend=0', () => {
    const results = computeRouteHighlights([
      { id: 'a1', distance: 5000, movingTime: 1000, date: 1 },
      { id: 'a2', distance: 5000, movingTime: 900, date: 2 },
    ]);
    expect(results[0].trend).toBe(0);
  });

  it('handles 7 activities with last being fastest', () => {
    const results = computeRouteHighlights([
      { id: 'a1', distance: 5000, movingTime: 2000, date: 1 },
      { id: 'a2', distance: 5000, movingTime: 1950, date: 2 },
      { id: 'a3', distance: 5000, movingTime: 1900, date: 3 },
      { id: 'a4', distance: 5000, movingTime: 1850, date: 4 },
      { id: 'a5', distance: 5000, movingTime: 1800, date: 5 },
      { id: 'a6', distance: 5000, movingTime: 1780, date: 6 },
      { id: 'a7', distance: 5000, movingTime: 1700, date: 7 },
    ]);
    expect(results[6].isPr).toBe(true);
    expect(results[6].trend).toBe(1);
    for (let i = 0; i < 6; i++) {
      expect(results[i].isPr).toBe(false);
    }
  });
});
