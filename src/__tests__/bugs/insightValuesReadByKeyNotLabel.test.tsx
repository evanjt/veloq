/**
 * Scenario: app language de-DE. The strength balance card found its ratio by
 * matching the label 'Ratio', the HRV sheet found its average and latest by
 * looking for 'avg' and 'latest' in the labels, and the efficiency sheet found
 * its effort count by 'effort'. In German the labels are 'Verhältnis',
 * '7-Tage-Durchschnitt', 'Neueste HRV' and 'Versuche', so all four vanished.
 *
 * Expected behaviour: each value is found by what it is, whatever the label
 * reads in the athlete's language.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { EfficiencyTrend } from 'veloqrs';

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import type { TFunc } from '@/features/insights/types';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { InsightDetailContent } from '@/features/insights/components/content/InsightDetailContent';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import type { StrengthSummary } from '@/features/strength/types';
import { datedSeries } from '../__shared__/datedSeries';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const NOW = Date.UTC(2026, 8, 20);
/** The app's own `t`, in whatever language the test switched to. */
const t = i18n.t.bind(i18n) as unknown as TFunc;

function strengthSummary(): StrengthSummary {
  const muscle = (slug: string, weightedSets: number) => ({
    slug,
    primarySets: weightedSets,
    secondarySets: 0,
    weightedSets,
    totalReps: 0,
    volumeKg: 0,
    exerciseNames: [],
    shade: 1,
  });
  return {
    muscleVolumes: [muscle('quadriceps', 12), muscle('hamstring', 5)],
    activityCount: 4,
    totalSets: 17,
    maxWeightedSets: 12,
    balance: [
      {
        id: 'quads_hamstrings',
        leftSlug: 'quadriceps',
        rightSlug: 'hamstring',
        leftWeightedSets: 12,
        rightWeightedSets: 5,
        dominantSlug: 'quadriceps',
        ratio: 2.4,
        status: 'watch',
      },
    ],
  };
}

const EFFICIENCY = {
  sectionId: 'river',
  sectionName: 'River Loop',
  direction: 0,
  effortCount: 9,
  hrChangeBpm: -4,
  trendSlope: -0.004,
  signalDelta: 1.2,
  points: [820, 805, 790, 781].map((hrPaceRatio, i) => ({ hrPaceRatio, date: i })),
} as unknown as EfficiencyTrend;

describe.each(['de-DE', 'it', 'ja', 'en-AU'] as const)('insight values in %s', (locale) => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage(locale);
  });

  afterAll(async () => {
    await changeLanguage('en-AU');
  });

  it('shows the strength balance ratio in the card caption', () => {
    const balance = generateStrengthInsights(
      strengthSummary(),
      [strengthSummary()],
      [],
      NOW,
      t
    ).find((i) => i.category === 'strength_balance');
    if (!balance) throw new Error('no balance card');

    // The decimal is the language's own: a comma in German and Italian.
    const decimal = locale === 'de-DE' || locale === 'it' ? ',' : '.';
    expect(balance.subtitle?.endsWith(` 2${decimal}4x`)).toBe(true);
  });

  it('shows the latest HRV and the average on the HRV sheet', async () => {
    const [hrv] = generateHrvTrendInsight(
      {
        label: 'trendingDown',
        avg: 62,
        latest: 58,
        dataPoints: 7,
        sparkline: datedSeries([64, 63, 63, 62, 61, 60, 58]),
      },
      NOW,
      t
    );
    const { getByTestId, toJSON } = await render(<InsightDetailContent insight={hrv} />);

    expect(getByTestId('insight-hero-value')).toHaveTextContent(/^58/);
    expect(JSON.stringify(toJSON())).toContain('62');
  });

  it('shows the effort count on the efficiency sheet', async () => {
    const [efficiency] = generateEfficiencyTrendInsights([EFFICIENCY], NOW, t);
    const { getAllByText, getByTestId } = await render(
      <InsightDetailSheet insight={efficiency} onClose={() => undefined} />
    );

    // The efforts row sits under the sheet's "How was this calculated?".
    await fireEvent.press(getByTestId('methodology-toggle'));
    expect(getAllByText('9')).toHaveLength(1);
  });
});
