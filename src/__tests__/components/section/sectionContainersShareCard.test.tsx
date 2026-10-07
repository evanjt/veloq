/**
 * Scenario: the containers below the section chart each drew their own
 * surface and margins, so the efficiency card touched the card under it and
 * the lap list and history panel sat on a different dark ground.
 *
 * Expected behaviour: each of them is the shared flat card in dark, with no
 * margin of its own, and the content area owns one gap between them.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { darkColors, layout } from '@/theme';
import { SectionCorrelationCard } from '@/features/routes/components/section/SectionCorrelationCard';
import { SectionEfficiencyCard } from '@/features/routes/components/section/SectionEfficiencyCard';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { SectionInfoCard } from '@/features/routes/components/section/SectionInfoCard';
import { SectionLapList } from '@/features/routes/components/section/SectionLapList';
import { SectionStatsCards } from '@/features/routes/components/section/SectionStatsCards';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    FfiCorrelation_Tags: {
      TooFew: 'TooFew',
      Undefined: 'Undefined',
      Inconclusive: 'Inconclusive',
      Mover: 'Mover',
    },
  })
);

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: true }),
}));

jest.mock('@/features/routes/hooks/useSectionEfficiencyTrend', () => ({
  useSectionEfficiencyTrend: () => ({
    trend: {
      sectionId: 's',
      sectionName: 'Hill',
      sportType: 'Ride',
      points: [
        { date: 1, paceSecsPerKm: 240, avgHr: 150, hrPaceRatio: 0.64 },
        { date: 2, paceSecsPerKm: 240, avgHr: 148, hrPaceRatio: 0.62 },
      ],
      trendSlope: -0.0004,
      direction: 0,
      hrChangeBpm: -2,
      effortCount: 2,
    },
  }),
}));

const MARGINS = ['margin', 'marginTop', 'marginBottom', 'marginHorizontal', 'marginVertical'];

type Json = { type: string; props: { style?: unknown; testID?: string }; children?: unknown[] };

function outermost(ui: React.ReactElement): Record<string, unknown> {
  const root = render(ui).toJSON() as Json;
  return StyleSheet.flatten(root.props.style as never) ?? {};
}

function expectFlatDarkCard(style: Record<string, unknown>) {
  expect(style.backgroundColor).toBe(darkColors.surfaceCard);
  expect(style.borderRadius).toBe(layout.borderRadius);
  expect(style.borderWidth).toBeUndefined();
  for (const key of MARGINS) expect(style[key]).toBeUndefined();
}

const calendar = {
  years: [
    {
      year: 2026,
      traversalCount: 1,
      activityCount: 1,
      forward: {
        count: 1,
        bestTime: 380,
        bestPace: 4.5,
        bestActivityId: 'a',
        bestActivityName: 'a',
      },
      months: [],
    },
  ],
  forwardPr: { count: 1, bestTime: 380, bestPace: 4.5, bestActivityId: 'a', bestActivityName: 'a' },
  sectionDistance: 2000,
} as never;

const lapRecord = {
  activityId: 'a',
  activityName: 'Ride a',
  activityDate: new Date('2026-08-01T00:00:00Z'),
  laps: [1, 2].map((startIndex) => ({
    id: `a-${startIndex}`,
    activityId: 'a',
    time: 120,
    pace: 3,
    distance: 300,
    direction: 'same',
    startIndex,
    endIndex: startIndex + 30,
    avgHr: null,
    avgPower: null,
    excluded: false,
  })),
  lapCount: 2,
  bestTime: 120,
  bestPace: 3,
  avgTime: 125,
  avgPace: 3,
  direction: 'same',
} as never;

describe('the containers below the section chart', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('draws the summary card as the flat dark card', () => {
    expectFlatDarkCard(
      outermost(
        <SectionInfoCard
          chartData={
            [
              { date: new Date(2026, 0, 1), x: 0 },
              { date: new Date(2026, 2, 1), x: 1 },
            ] as never
          }
          bestForwardRecord={{ bestTime: 550, bestPace: 3, sectionDistance: 2000 } as never}
          forwardStats={{ avgTime: 600, count: 10 } as never}
          bestReverseRecord={null}
          reverseStats={null}
          sportType="Run"
          isDark
        />
      )
    );
  });

  it('draws the efficiency card as the flat dark card, borderless', () => {
    expectFlatDarkCard(outermost(<SectionEfficiencyCard sectionId="s" isDark />));
  });

  it('draws the correlation card as the flat dark card', () => {
    expectFlatDarkCard(
      outermost(
        <SectionCorrelationCard
          correlations={
            [
              { direction: 'same', variable: 'sleep', result: { tag: 'TooFew', inner: { n: 2 } } },
            ] as never
          }
          floor={5}
          isDark
        />
      )
    );
  });

  it('draws the calendar card as the flat dark card', () => {
    expectFlatDarkCard(
      outermost(
        <SectionStatsCards
          calendarSummary={calendar}
          isDark
          isRunning={false}
          activityColor="#3B82F6"
        />
      )
    );
  });

  it('draws the lap list as the flat dark card', () => {
    expectFlatDarkCard(
      outermost(
        <SectionLapList
          isDark
          records={[lapRecord]}
          onExcludeLap={() => {}}
          onIncludeLap={() => {}}
        />
      )
    );
  });

  it('draws the history panel as the flat dark card', () => {
    expectFlatDarkCard(
      outermost(
        <SectionHistoryPanel
          isDark
          history={[]}
          versions={[]}
          pinnedVersion={null}
          shownVersion={null}
          onShowVersion={() => {}}
          onRevert={() => {}}
          onUnpin={() => {}}
          activityNames={{}}
          failureKey={null}
        />
      )
    );
  });
});
