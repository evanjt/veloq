/**
 * Scenario: the summary card draws its hero, change line, fatigue and form
 * lines, HRV, resting heart rate and supporting metrics in every hero mode.
 *
 * Expected behaviour: no text is set in a series, sport or zone colour. A value
 * is the theme's primary text and a label its secondary text, and a series
 * value carries a key dot in the colour its line is drawn in.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { act, render, renderHook } from '@testing-library/react-native';

import { SummaryCard } from '@/features/home/components/SummaryCard';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { summarySeriesColor } from '@/features/home/lib/summaryMetricColour';
import { useDashboardPreferences } from '@/features/settings/stores/summaryCardPreferences';
import { colors, darkColors } from '@/theme';

const mockScheme = { current: 'light' as 'light' | 'dark' };

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme.current,
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const CARD = {
  wellness: {
    fitness: 62,
    fatigue: 70,
    form: -8,
    hrv: 58,
    rhr: 47,
    fitnessTrend: '↑',
    hrvTrend: '↓',
  },
  currentWeek: { count: 3, totalDuration: 9000 },
  prevWeek: { count: 2, totalDuration: 7200 },
  ftpTrend: { latestFtp: 250, previousFtp: 245 },
  runPaceTrend: {},
  swimPaceTrend: {},
};

const SPARKLINES = {
  fitness: [58, 60, 62],
  fitnessDelta: 4,
  fitnessRiseDays: [1, 2],
  fatigue: [64, 68, 70],
  form: [-6, -8, -8],
  hrv: [55, 57, 58],
  rhr: [48, 47, 47],
  hrvRead: [true, true, true],
  rhrRead: [true, true, true],
};

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
afterEach(() => {
  useDashboardPreferences.setState({ summaryCard: DEFAULTS });
  mockScheme.current = 'light';
});

async function renderCard(heroMetric: 'fitness' | 'form' | 'hrv', showSparkline: boolean) {
  useDashboardPreferences.setState({
    summaryCard: {
      ...DEFAULTS,
      heroMetric,
      showSparkline,
      supportingMetrics: ['fitness', 'hrv', 'ftp', 'form'],
    },
  });
  const { result } = await renderHook(() =>
    useSummaryCardData(CARD, { awaitPrecomputed: true, precomputedSparklines: SPARKLINES })
  );
  const tree = await render(<SummaryCard {...result.current} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

function textColours(tree: Awaited<ReturnType<typeof renderCard>>): string[] {
  return tree.UNSAFE_root.findAll((node) => node.type === Text)
    .map((node) => StyleSheet.flatten(node.props.style)?.color)
    .filter((c): c is string => typeof c === 'string');
}

const CASES = (['light', 'dark'] as const).flatMap((scheme) =>
  (['fitness', 'form', 'hrv'] as const).flatMap((hero) =>
    [true, false].map((sparkline) => [scheme, hero, sparkline] as const)
  )
);

describe('the summary card text', () => {
  it.each(CASES)(
    'is primary or secondary ink in %s with a %s hero, sparkline %s',
    async (scheme, hero, sparkline) => {
      mockScheme.current = scheme;
      const palette = scheme === 'dark' ? darkColors : colors;
      const tree = await renderCard(hero, sparkline);

      const colours = textColours(tree);
      expect(colours.length).toBeGreaterThan(0);
      for (const colour of colours) {
        expect([palette.textPrimary, palette.textSecondary]).toContain(colour);
      }
    }
  );

  it.each(['light', 'dark'] as const)(
    'keys the fitness value with a dot in its series colour in %s',
    async (scheme) => {
      mockScheme.current = scheme;
      const tree = await renderCard('fitness', true);

      expect(tree.getByTestId('summary-card-key-fitness')).toHaveStyle({
        backgroundColor: summarySeriesColor('fitness', scheme === 'dark'),
      });
      expect(tree.getByTestId('summary-card-key-fatigue')).toHaveStyle({
        backgroundColor: summarySeriesColor('fatigue', scheme === 'dark'),
      });
    }
  );

  it('keys HRV and resting heart rate with dots in their series colours', async () => {
    const tree = await renderCard('hrv', true);

    expect(tree.getByTestId('summary-card-key-hrv')).toHaveStyle({
      backgroundColor: summarySeriesColor('hrv', false),
    });
    expect(tree.getByTestId('summary-card-key-rhr')).toHaveStyle({
      backgroundColor: summarySeriesColor('rhr', false),
    });
  });
});
