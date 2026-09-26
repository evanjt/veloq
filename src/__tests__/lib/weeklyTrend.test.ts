/**
 * Scenario: the weekly summary compared each number raw, so two identical
 * weeks drew four down arrows in warning amber, and it decided on its own that
 * a heavier load week was a warning.
 *
 * Expected behaviour: one helper reads the deadband and the polarity from the
 * trend tables, draws flat as a glyph, and says nothing when there is no
 * previous period to compare.
 */

import { weeklyTrend } from '@/features/stats/lib/weeklyTrend';

describe('weeklyTrend', () => {
  it('draws flat four times for two identical weeks, never a decline', () => {
    const same = { count: 5, duration: 5 * 3600, distance: 120_000, tss: 320 };
    for (const metric of ['count', 'duration', 'distance', 'tss'] as const) {
      const cell = weeklyTrend(metric, same[metric], same[metric]);
      expect(cell).toEqual({ glyph: '→', rung: 'neutral', pct: null });
    }
  });

  it('says nothing when there is no previous period', () => {
    expect(weeklyTrend('count', 5, 0)).toBeNull();
    expect(weeklyTrend('tss', 300, 0)).toBeNull();
  });

  it('holds the deadband from the table rather than a raw compare', () => {
    // 20 minutes more is under the half-hour deadband; 600 m is under a kilometre.
    expect(weeklyTrend('duration', 5 * 3600 + 20 * 60, 5 * 3600)?.glyph).toBe('→');
    expect(weeklyTrend('distance', 120_600, 120_000)?.glyph).toBe('→');
    expect(weeklyTrend('tss', 303, 300)?.glyph).toBe('→');
  });

  it('reads more activities, hours and distance as improved', () => {
    expect(weeklyTrend('count', 6, 5)).toEqual({ glyph: '↑', rung: 'positive', pct: '20%' });
    expect(weeklyTrend('duration', 6 * 3600, 5 * 3600)?.rung).toBe('positive');
    expect(weeklyTrend('distance', 130_000, 120_000)?.rung).toBe('positive');
    expect(weeklyTrend('count', 4, 5)).toEqual({ glyph: '↓', rung: 'negative', pct: '20%' });
  });

  it('gives a heavier load week a direction and no judgement', () => {
    // Load is fatigue's number: a bare arrow on the neutral rung, the way
    // intervals.icu draws it, rather than a warning the component invented.
    expect(weeklyTrend('tss', 360, 300)).toEqual({ glyph: '↑', rung: 'neutral', pct: '20%' });
    expect(weeklyTrend('tss', 240, 300)).toEqual({ glyph: '↓', rung: 'neutral', pct: '20%' });
  });
});
