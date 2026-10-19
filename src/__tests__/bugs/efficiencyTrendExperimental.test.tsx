/**
 * Scenario: the efficiency trend is heart rate times pace, a figure nobody can
 * read and whose sign can disagree with heart rate at a matched pace. It is an
 * experimental feature behind the developer switch.
 *
 * Expected behaviour: with the switch off the trend appears nowhere, neither on
 * the Insights list, the home-screen widget nor the section and route pages.
 * With it on, the insight and the card are there, each labelled experimental.
 * The list and the widget rank through one computation, the widget passing only
 * the payload, the translator and the units, so the computation reads the switch.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { EfficiencyDirection } from 'veloqrs';
import type { EfficiencyTrend, InsightsData } from 'veloqrs';

import { computeInsightsFromData } from '@/features/insights/lib/computeInsightsData';
import { InsightListCard } from '@/features/insights/components/InsightListCard';
import { SectionContentArea } from '@/features/routes/components/section/SectionContentArea';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => true),
}));

jest.mock('@/features/routes/components/section/SectionPerformanceSection', () => ({
  SectionPerformanceSection: () => null,
}));
jest.mock('@/features/routes/components/section/SectionInfoCard', () => ({
  SectionInfoCard: () => null,
}));
jest.mock('@/features/routes/components/section/SectionCorrelationCard', () => ({
  SectionCorrelationCard: () => null,
}));

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const EMPTY_PERIOD = { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 };

function efficiencyTrend(): EfficiencyTrend {
  return {
    sectionId: 'larch-lane',
    sectionName: 'Larch Lane',
    sportType: 'Run',
    points: [430, 425, 418, 410].map((hrPaceRatio, i) => ({
      date: 86_400 * (i + 1),
      paceSecsPerKm: 300,
      avgHr: 150,
      hrPaceRatio,
    })),
    trendSlope: -0.4,
    direction: EfficiencyDirection.Improving,
    hrChangeBpm: -6.2,
    effortCount: 12,
    signalDelta: -0.05,
  } as EfficiencyTrend;
}

function bundle(): InsightsData {
  return {
    form: null,
    currentWeek: EMPTY_PERIOD,
    previousWeek: EMPTY_PERIOD,
    chronicWeekAverage: EMPTY_PERIOD,
    chronicWeeks: [],
    recentPrs: [],
    sectionCount: 5,
    rankedSections: [],
    efficiencyTrends: [efficiencyTrend()],
    recentSectionChanges: [],
    stalePrOpportunities: [],
    hasStrengthData: false,
    sportTypes: [],
  } as unknown as InsightsData;
}

const efficiencyInsights = (insights: { category: string }[]) =>
  insights.filter((i) => i.category === 'efficiency_trend');

describe('the efficiency trend on the Insights list and the widget', () => {
  afterEach(() => {
    useDebugStore.setState({ enabled: false, unlocked: false });
  });

  it('yields no efficiency insight without the experimental switch', () => {
    useDebugStore.setState({ enabled: false, unlocked: false });
    const { insights } = computeInsightsFromData(bundle(), t, true);
    expect(efficiencyInsights(insights)).toEqual([]);
  });

  it('yields one, labelled experimental, with the switch on', () => {
    useDebugStore.setState({ enabled: true, unlocked: true });
    const { insights } = computeInsightsFromData(bundle(), t, true);
    const shown = efficiencyInsights(insights) as { experimental?: boolean }[];
    expect(shown).toHaveLength(1);
    expect(shown[0].experimental).toBe(true);
  });

  it('follows a flip of the switch between two reads', () => {
    useDebugStore.setState({ enabled: true, unlocked: true });
    expect(efficiencyInsights(computeInsightsFromData(bundle(), t, true).insights)).toHaveLength(1);

    useDebugStore.setState({ enabled: false, unlocked: false });
    expect(efficiencyInsights(computeInsightsFromData(bundle(), t, true).insights)).toEqual([]);
  });

  it('draws the experimental label on the list card', async () => {
    useDebugStore.setState({ enabled: true, unlocked: true });
    const { insights } = computeInsightsFromData(bundle(), t, true);
    const insight = insights.find((i) => i.category === 'efficiency_trend');
    expect(insight).toBeDefined();
    const screen = await render(<InsightListCard insight={insight!} onPress={() => {}} />);
    expect(screen.getByTestId('insight-experimental')).toBeTruthy();
  });

  it('draws no experimental label on a card that is not experimental', async () => {
    useDebugStore.setState({ enabled: true, unlocked: true });
    const { insights } = computeInsightsFromData(bundle(), t, true);
    const insight = insights.find((i) => i.category === 'efficiency_trend')!;
    const { experimental: _experimental, ...settled } = insight;
    const screen = await render(<InsightListCard insight={settled} onPress={() => {}} />);
    expect(screen.queryByTestId('insight-experimental')).toBeNull();
  });
});

describe('the efficiency card on the section and route pages', () => {
  const props = {
    isDark: false,
    mergeCandidates: [],
    isSectionDisabled: false,
    combinedChartData: [],
    trendCurves: {},
    calendarSummary: null,
    correlations: [],
    correlationFloor: 0,
    efficiencyTrend: efficiencyTrend(),
  } as unknown as React.ComponentProps<typeof SectionContentArea>;

  afterEach(() => {
    useDebugStore.setState({ enabled: false, unlocked: false });
  });

  it('draws no efficiency card without the switch', async () => {
    useDebugStore.setState({ enabled: false });
    const screen = await render(<SectionContentArea {...props} />);
    expect(screen.queryByTestId('section-efficiency-card')).toBeNull();
  });

  it('draws the card, labelled experimental, with the switch on', async () => {
    useDebugStore.setState({ enabled: true, unlocked: true });
    const screen = await render(<SectionContentArea {...props} />);
    expect(screen.getByTestId('section-efficiency-card')).toBeTruthy();
    expect(screen.getByTestId('section-efficiency-experimental')).toBeTruthy();
  });
});
