import type { Insight } from '@/types';
import { INSIGHTS_CONFIG } from '@/hooks/insights/config';
import {
  applyMixAndCap,
  passesProximity,
  passesRecency,
  passesRepetition,
  passesValence,
  scoreInsight,
  signalScore,
  specificityScore,
  temporalSelfScore,
  type Bbox,
} from '@/hooks/insights/rules';

const DAY_MS = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch for deterministic tests

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'test',
    category: 'section_trend',
    priority: 2,
    title: 'Test insight',
    icon: 'trending-up',
    iconColor: '#000',
    timestamp: NOW,
    isNew: false,
    ...overrides,
  };
}

describe('rules.passesRecency (G1)', () => {
  it('passes when sourceTimestamp is absent (opt-in gate)', () => {
    const insight = makeInsight();
    expect(passesRecency(insight, NOW).passed).toBe(true);
  });

  it('passes when event is fresh', () => {
    const insight = makeInsight({
      meta: { sourceTimestamp: NOW - 3 * DAY_MS },
    });
    expect(passesRecency(insight, NOW).passed).toBe(true);
  });

  it('rejects when event exceeds activeWindowDays', () => {
    const insight = makeInsight({
      category: 'section_trend',
      meta: { sourceTimestamp: NOW - 45 * DAY_MS }, // 28-day window default
    });
    const result = passesRecency(insight, NOW);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('recency_too_old');
  });

  it('section_pr uses its tighter 14-day window', () => {
    const old = makeInsight({
      category: 'section_pr',
      meta: { sourceTimestamp: NOW - 20 * DAY_MS },
    });
    expect(passesRecency(old, NOW).passed).toBe(false);
    const fresh = makeInsight({
      category: 'section_pr',
      meta: { sourceTimestamp: NOW - 3 * DAY_MS },
    });
    expect(passesRecency(fresh, NOW).passed).toBe(true);
  });

  it('stale_pr rejects events that are too recent', () => {
    const tooFresh = makeInsight({
      category: 'stale_pr',
      meta: { sourceTimestamp: NOW - 5 * DAY_MS },
    });
    const result = passesRecency(tooFresh, NOW);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('recency_too_recent');
  });

  it('stale_pr accepts events inside its min-max window', () => {
    const goodStaleness = makeInsight({
      category: 'stale_pr',
      meta: { sourceTimestamp: NOW - 90 * DAY_MS },
    });
    expect(passesRecency(goodStaleness, NOW).passed).toBe(true);
  });
});

describe('rules.passesProximity (G2)', () => {
  const region: Bbox = { minLat: 46.4, maxLat: 46.6, minLng: 6.5, maxLng: 6.7 };

  it('passes when gate is disabled', () => {
    const cfg = {
      ...INSIGHTS_CONFIG,
      proximity: { ...INSIGHTS_CONFIG.proximity, enabled: false },
    };
    const insight = makeInsight({
      meta: { location: { lat: 50, lng: 10 } },
    });
    expect(passesProximity(insight, region, cfg).passed).toBe(true);
  });

  it('passes when active region is null', () => {
    const insight = makeInsight({
      meta: { location: { lat: 50, lng: 10 } },
    });
    expect(passesProximity(insight, null).passed).toBe(true);
  });

  it('passes when insight has no location', () => {
    const insight = makeInsight();
    expect(passesProximity(insight, region).passed).toBe(true);
  });

  it('passes when insight centroid is inside padded region', () => {
    const insight = makeInsight({
      meta: { location: { lat: 46.5, lng: 6.6 } }, // Lausanne-ish
    });
    expect(passesProximity(insight, region).passed).toBe(true);
  });

  it('rejects when insight centroid is far outside region', () => {
    const insight = makeInsight({
      meta: { location: { lat: 48.8, lng: 2.3 } }, // Paris
    });
    const result = passesProximity(insight, region);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('proximity_outside_region');
  });
});

describe('rules.passesRepetition (G3)', () => {
  it('passes when category has no repetition requirement', () => {
    const insight = makeInsight({
      category: 'hrv_trend',
      meta: { repetitionCount: 0 },
    });
    expect(passesRepetition(insight).passed).toBe(true);
  });

  it('rejects section_trend below min traversals', () => {
    const insight = makeInsight({
      category: 'section_trend',
      meta: { repetitionCount: 2 },
    });
    const result = passesRepetition(insight);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('repetition_below_min');
  });

  it('accepts section_trend at or above min', () => {
    const insight = makeInsight({
      category: 'section_trend',
      meta: { repetitionCount: 3 },
    });
    expect(passesRepetition(insight).passed).toBe(true);
  });
});

describe('rules.passesValence (G4)', () => {
  it('passes neutral copy', () => {
    const insight = makeInsight({
      title: 'Hill Climb: 3s faster median in 4 weeks',
      body: 'Median effort dropped from 2:45 to 2:42 across 5 attempts.',
    });
    expect(passesValence(insight).passed).toBe(true);
  });

  it('rejects punitive "you haven\'t" copy', () => {
    const insight = makeInsight({
      title: "You haven't trained this week",
    });
    const result = passesValence(insight);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('valence_punitive');
  });

  it('rejects "you failed" copy', () => {
    const insight = makeInsight({
      title: 'Goal update',
      body: 'You failed to match your previous time.',
    });
    expect(passesValence(insight).passed).toBe(false);
  });
});

describe('rules.specificityScore (R5)', () => {
  it('awards all3 bonus when all three tags set', () => {
    const insight = makeInsight({
      meta: { specificity: { hasNumber: true, hasPlace: true, hasDate: true } },
    });
    expect(specificityScore(insight)).toBe(10);
  });

  it('awards any2 bonus for partial specificity', () => {
    const insight = makeInsight({
      meta: { specificity: { hasNumber: true, hasPlace: true, hasDate: false } },
    });
    expect(specificityScore(insight)).toBe(5);
  });

  it('returns 0 when no tags set', () => {
    const insight = makeInsight({
      meta: { specificity: { hasNumber: false, hasPlace: false, hasDate: false } },
    });
    expect(specificityScore(insight)).toBe(0);
  });

  it('returns 0 when meta missing', () => {
    expect(specificityScore(makeInsight())).toBe(0);
  });
});

describe('rules.signalScore (R6)', () => {
  it('peaks in the flow corridor', () => {
    const insight = makeInsight({ meta: { signalDelta: 1.0 } });
    expect(signalScore(insight)).toBe(10);
  });

  it('penalises below-floor noise', () => {
    const insight = makeInsight({ meta: { signalDelta: 0.2 } });
    expect(signalScore(insight)).toBe(-5);
  });

  it('gives small credit above ceiling', () => {
    const insight = makeInsight({ meta: { signalDelta: 3.0 } });
    expect(signalScore(insight)).toBe(3);
  });

  it('returns 0 when delta missing', () => {
    expect(signalScore(makeInsight())).toBe(0);
  });
});

describe('rules.temporalSelfScore (R7)', () => {
  it('bonuses self-comparison', () => {
    const insight = makeInsight({ meta: { comparisonKind: 'self' } });
    expect(temporalSelfScore(insight)).toBe(5);
  });

  it('returns 0 for other comparisons', () => {
    const insight = makeInsight({ meta: { comparisonKind: 'other' } });
    expect(temporalSelfScore(insight)).toBe(0);
  });
});

describe('rules.scoreInsight', () => {
  it('combines base, category, specificity, temporal-self, signal', () => {
    const insight = makeInsight({
      category: 'section_pr',
      priority: 1,
      confidence: 1,
      meta: {
        specificity: { hasNumber: true, hasPlace: true, hasDate: true },
        comparisonKind: 'self',
        signalDelta: 1.0,
      },
    });
    const { score, breakdown } = scoreInsight(insight);
    // base = (6 - 1) * 50 + 1 * 30 = 280
    // category section_pr = 15
    // specificity all3 = 10
    // temporalSelf = 5
    // signal in corridor = 10
    // total = 320
    expect(breakdown.base).toBe(280);
    expect(breakdown.category).toBe(15);
    expect(breakdown.specificity).toBe(10);
    expect(breakdown.temporalSelf).toBe(5);
    expect(breakdown.signal).toBe(10);
    expect(score).toBe(320);
  });
});

describe('rules.applyMixAndCap (D9, D10)', () => {
  const mk = (id: string, category: Insight['category'], score: number) => ({
    insight: makeInsight({ id, category }),
    score,
    breakdown: { base: 0, category: 0, specificity: 0, temporalSelf: 0, signal: 0 },
  });

  it('enforces per-category cap', () => {
    const scored = [
      mk('a', 'section_trend', 100),
      mk('b', 'section_trend', 90),
      mk('c', 'section_trend', 80),
    ];
    const { kept, dropped } = applyMixAndCap(scored);
    // Default section_trend cap is INSIGHTS_CONFIG.surface.maxPerCategory = 2
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('category_cap');
  });

  it('uses section_pr override (3) instead of default cap (2)', () => {
    const scored = [
      mk('a', 'section_pr', 100),
      mk('b', 'section_pr', 90),
      mk('c', 'section_pr', 80),
      mk('d', 'section_pr', 70),
    ];
    const { kept, dropped } = applyMixAndCap(scored);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(1);
  });

  it('enforces total surface cap when categories leave room', () => {
    // Use many distinct categories so maxPerCategory doesn't dominate.
    const categories = [
      'section_pr',
      'efficiency_trend',
      'stale_pr',
      'fitness_milestone',
      'hrv_trend',
      'section_trend',
      'strength_balance',
      'period_comparison',
      'strength_progression',
    ] as const;
    const scored = Array.from({ length: 20 }, (_, i) =>
      mk(`i${i}`, categories[i % categories.length], 100 - i)
    );
    const { kept, dropped } = applyMixAndCap(scored);
    expect(kept).toHaveLength(INSIGHTS_CONFIG.surface.maxTotal);
    expect(dropped.some((d) => d.reason === 'surface_cap' || d.reason === 'category_cap')).toBe(
      true
    );
  });

  it('per-category cap bounds the total when few categories exist', () => {
    // 3 categories × maxPerCategory=2 = 6 kept (below maxTotal=8).
    const scored = Array.from({ length: 20 }, (_, i) =>
      mk(
        `i${i}`,
        (['hrv_trend', 'fitness_milestone', 'period_comparison'] as const)[i % 3],
        100 - i
      )
    );
    const { kept } = applyMixAndCap(scored);
    expect(kept).toHaveLength(3 * INSIGHTS_CONFIG.surface.maxPerCategory);
  });

  it('sorts by score descending, ties broken by priority', () => {
    const scored = [
      mk('low', 'hrv_trend', 50),
      mk('high', 'fitness_milestone', 200),
      mk('mid', 'period_comparison', 100),
    ];
    const { kept } = applyMixAndCap(scored);
    expect(kept.map((i) => i.id)).toEqual(['high', 'mid', 'low']);
  });
});
