/**
 * Scenario: the stale-PR card was decided twice, once by the engine's own
 * filter and sort over SQLite-resident trends, and once by a TypeScript
 * detector kept as the branch for jest and the pre-sync window. The two
 * policies drifted apart while the thresholds stayed single-sourced. It was
 * then decided by the engine, but through a call of this generator's own, on
 * top of the heaviest read in the tree.
 *
 * Expected behaviour: the engine decides, and only the engine, and the rows
 * ride the insights bundle. A bundle that carries none produces no card,
 * rather than a second opinion.
 */

import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import type { StalePrOpportunity } from 'veloqrs';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const NOW = Math.floor(Date.now() / 1000);

const ROW: StalePrOpportunity = {
  sectionId: 's1',
  sectionName: 'Hill Climb',
  bestTimeSecs: 263,
  daysSinceLast: 90,
  traversalCount: 5,
  fitnessMetric: 'power',
  currentValue: 240,
  previousValue: 200,
  gainPercent: 20,
  unit: 'W',
  sportType: 'Ride',
  recentEfforts: [],
};

describe('generateStalePRInsights', () => {
  it('renders what the bundle carries', () => {
    const insights = generateStalePRInsights([ROW], t, NOW);

    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe('stale_pr-s1:Ride');
  });

  /**
   * The engine fills each row's recent efforts so the card has a line to draw
   * at list render, and the generator copies the row before building the card.
   */
  it('draws the single card from the efforts the row carries', () => {
    const row: StalePrOpportunity = {
      ...ROW,
      recentEfforts: [
        { value: 281, date: 1_700_000_000 },
        { value: 274, date: 1_700_600_000 },
        { value: 263, date: 1_701_200_000 },
      ],
    };

    const [card] = generateStalePRInsights([row], t, NOW);

    expect(card.supportingData?.sparklineData).toEqual([281, 274, 263]);
    expect(card.supportingData?.sparklineLabel).toBe('insights.data.recentEfforts');
  });

  it('carries no line when the row has too few efforts to draw one', () => {
    const row: StalePrOpportunity = {
      ...ROW,
      recentEfforts: [
        { value: 281, date: 1_700_000_000 },
        { value: 263, date: 1_701_200_000 },
      ],
    };

    const [card] = generateStalePRInsights([row], t, NOW);

    expect(card.supportingData?.sparklineData).toBeUndefined();
    expect(card.supportingData?.sparklineLabel).toBeUndefined();
  });

  it('renders nothing when the bundle carries none, rather than deciding for itself', () => {
    expect(generateStalePRInsights([], t, NOW)).toEqual([]);
  });

  /** An engine that could not answer leaves the field off the record. */
  it('renders nothing when the bundle has no opportunities at all', () => {
    expect(generateStalePRInsights(undefined, t, NOW)).toEqual([]);
  });

  /**
   * The group card names the sport each section was ranked under, and it comes
   * off the row rather than being looked up in a section list the generator
   * used to be handed.
   */
  it('names each section’s sport on the group card', () => {
    const second: StalePrOpportunity = {
      ...ROW,
      sectionId: 's2',
      sectionName: 'River Path',
      fitnessMetric: 'pace',
      unit: '/km',
      currentValue: 300,
      previousValue: 330,
      sportType: 'Run',
    };

    const [group] = generateStalePRInsights([ROW, second], t, NOW);

    expect(group.supportingData?.sections?.map((s) => s.sportType)).toEqual(['Ride', 'Run']);
  });
});
