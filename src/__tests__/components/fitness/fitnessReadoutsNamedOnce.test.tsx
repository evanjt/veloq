/**
 * Scenario: the Fitness tab's performance section titles its curve, and the curve chart inside it
 * titled itself the same way, so "Power curve" read twice, one under the other. The form chart
 * under the fitness plot printed its own day, form value and zone, a second readout of the form
 * the fitness readout already shows.
 *
 * Expected behaviour: each curve is named once, by its section, and keeps its scrub readout. The
 * fitness card prints the form value once, in the fitness readout, with the zone named beside it.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import { RangeCoverage } from 'veloqrs';

import { initialiseI18n } from '@/i18n';
import { PerformanceCurveSection } from '@/features/fitness/components/sections/PerformanceCurveSection';
import { FitnessChartCard } from '@/features/fitness/components/sections/FitnessChartCard';
import type { PrimarySport } from '@/features/fitness/stores';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({
    data: { type: 'power', sport: 'Ride', secs: [5, 60, 1200], watts: [800, 500, 300] },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: () => ({
    data: {
      type: 'pace',
      sport: 'Run',
      distances: [100, 400, 1000],
      times: [20, 90, 240],
      pace: [5, 4.4, 4.2],
      activity_ids: ['quarry-a', 'quarry-b', 'quarry-c'],
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('@/features/activity', () => ({
  useActivityLabels: () => ({ labels: new Map(), error: null }),
  useActivities: () => ({ data: [] }),
}));

jest.mock('@/features/fitness/components/SeasonBestsSection', () => ({
  SeasonBestsSection: () => null,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the performance curve section expanded', () => {
  it.each([
    ['Cycling', 'Power curve'],
    ['Running', 'Pace curve'],
    ['Swimming', 'Swim pace curve'],
  ] as const)('names the %s curve once', async (sport, title) => {
    await render(
      <PerformanceCurveSection
        sportMode={sport as PrimarySport}
        days={30}
        timeRange="1m"
        currentFTP={300}
        thresholdPace={undefined}
        swimThresholdPace={undefined}
        performanceExpanded
        onPerformanceToggle={() => {}}
        bestsExpanded={false}
        onBestsToggle={() => {}}
        bestsEfforts={[]}
        bestsClimbing={[]}
        bestsClimbingStatus={'ready' as never}
        loadingBests={false}
        bestsHeader={null}
      />
    );

    expect(screen.getAllByText(title, { exact: true })).toHaveLength(1);
  });
});

/** Form -3 on fitness 40 sits in the grey zone. */
const DAYS = [
  { id: '2026-09-11', ctl: 39, atl: 41 },
  { id: '2026-09-12', ctl: 40, atl: 43 },
] as WellnessData[];

function Card() {
  const shared = useSharedValue(-1);
  return (
    <FitnessChartCard
      wellness={DAYS}
      wellnessCoverage={RangeCoverage.Loaded}
      activities={[]}
      dailyLoads={[]}
      eftpChanges={[]}
      selectedDate={null}
      sharedSelectedIdx={shared}
      onDateSelect={() => {}}
      onInteractionChange={() => {}}
    />
  );
}

describe('the fitness chart card', () => {
  it('prints the form value once, in the fitness readout', async () => {
    await render(<Card />);

    expect(screen.getAllByText('-3', { exact: true })).toHaveLength(1);
    expect(screen.getByTestId('fitness-form-value')).toHaveTextContent('-3', { exact: true });
  });

  it('names the zone once, in the readout beside form', async () => {
    await render(<Card />);

    expect(screen.getByTestId('fitness-form-zone')).toHaveTextContent('Grey zone', {
      exact: true,
    });
    expect(screen.queryByTestId('form-chart-zone')).toBeNull();
  });
});
