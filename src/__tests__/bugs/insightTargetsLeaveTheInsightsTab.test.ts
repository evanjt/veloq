/**
 * Scenario: Evan, 2026-09-18: "the view in detail buttons don't seem to link
 * anywhere." The three period-comparison cards targeted `/insights?tab=routes`,
 * and the sheet is opened from the Insights tab, so tapping the button closed
 * the sheet and landed on the tab the athlete was already on.
 *
 * Expected behaviour: a card opens the thing it is a picture of. A period
 * comparison is a picture of a fitness window, so it opens that window, and no
 * generator targets the tab the sheet is opened from.
 */

import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { fitnessEntryFromParams } from '@/shared/app/fitnessEntry';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';

const GENERATORS = resolve(__dirname, '../../features/insights/generators');

const t = ((key: string) => key) as unknown as Parameters<
  typeof generatePeriodComparisonInsights
>[7];

const week = { count: 5, totalDuration: 18_000, totalDistance: 150_000, totalTss: 400 };
const quietWeek = { count: 3, totalDuration: 9_000, totalDistance: 70_000, totalTss: 180 };

function entryOf(target: string | undefined) {
  const [path, query = ''] = (target ?? '').split('?');
  return {
    path,
    ...fitnessEntryFromParams(Object.fromEntries(new URLSearchParams(query))),
  };
}

describe('where an insight card goes', () => {
  it('sends a week against the week before to the window that holds both', () => {
    const [insight] = generatePeriodComparisonInsights(
      week,
      quietWeek,
      null,
      undefined,
      { metric: 'tss', current: 400, previous: 180, ratio: 1.22 },
      null,
      Date.UTC(2026, 8, 18),
      t
    );

    expect(entryOf(insight.navigationTarget)).toMatchObject({ path: '/fitness', range: '1m' });
  });

  it('sends a week against the four-week average to the window that holds both', () => {
    const [insight] = generatePeriodComparisonInsights(
      { ...week, count: 0, totalTss: 0, totalDuration: 0 },
      week,
      quietWeek,
      undefined,
      null,
      { metric: 'tss', current: 400, previous: 180, ratio: 1.22 },
      Date.UTC(2026, 8, 18),
      t
    );

    expect(entryOf(insight.navigationTarget)).toMatchObject({ path: '/fitness', range: '3m' });
  });

  it('has no generator targeting the Insights tab, which is where the sheet is opened', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(GENERATORS).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(resolve(GENERATORS, file), 'utf8');
      for (const [, target] of source.matchAll(/navigationTarget:\s*'([^']*)'/g)) {
        if (target.startsWith('/insights')) offenders.push(`${file}: ${target}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
