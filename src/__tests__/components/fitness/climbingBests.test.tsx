/**
 * Scenario: the engine read carries a climbing best per window for Ride and
 * Run, and Season Bests and Best Efforts drew only power and pace.
 *
 * Expected behaviour: Season Bests lists the climbing rows after the sport's
 * own bests, short windows in W/kg and long ones in m/h, an unmeasured window
 * as a dash, and the climbing rows alone keep the card from reading empty.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';
import { climbBestsOf, climbStatusOf } from '@/features/stats/hooks/useSeasonBests';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import type { BestEffortsData } from 'veloqrs';

jest.mock('@/features/activity', () => ({
  useActivityLabels: () => ({
    labels: new Map([['hill-run', { name: 'Hill reps', date: '' }]]),
    error: null,
  }),
}));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const read = {
  sports: [],
  climbing: [
    {
      sport: 'Run',
      owed: 0,
      sourceExcluded: 0,
      bests: [
        { label: '15s', windowS: 15, vam: 1800, wattsPerKg: 4.905, activityId: 'hill-run' },
        { label: '5m', windowS: 300, vam: undefined, wattsPerKg: undefined },
        { label: '10m', windowS: 600, vam: 900, wattsPerKg: 2.45, activityId: 'hill-run' },
      ],
    },
  ],
} as unknown as BestEffortsData;

describe('climbBestsOf', () => {
  it('picks the family of the sport and none for swimming', () => {
    expect(climbBestsOf(read, 'Running').map((b) => b.label)).toEqual(['15s', '5m', '10m']);
    expect(climbBestsOf(read, 'Cycling')).toEqual([]);
    expect(climbBestsOf(read, 'Swimming')).toEqual([]);
    expect(climbBestsOf(null, 'Running')).toEqual([]);
  });

  it('carries a missing value as null', () => {
    const [, unmeasured] = climbBestsOf(read, 'Running');
    expect(unmeasured.vam).toBeNull();
    expect(unmeasured.wattsPerKg).toBeNull();
  });
});

describe('Season Bests climbing rows', () => {
  beforeEach(() => useUnitPreference.setState({ unitPreference: 'metric' }));

  it('draws W/kg for a short window, m/h for a long one and a dash for a gap', () => {
    render(
      <SeasonBestsSection
        efforts={[]}
        climbing={climbBestsOf(read, 'Running')}
        sport="Running"
        isLoading={false}
      />
    );

    expect(screen.getByText('bestEffortsScreen.climbingBests')).toBeTruthy();
    expect(screen.getByText('4.91 units.wattsPerKg')).toBeTruthy();
    expect(screen.getByText('900 units.metresPerHour')).toBeTruthy();
    expect(screen.getByTestId('season-bests-climbing-300')).toHaveTextContent('5m-', {
      exact: true,
    });
    expect(screen.queryByText('statsScreen.noEffortData')).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('draws no climbing heading when there are no climbing rows', () => {
    render(<SeasonBestsSection efforts={[]} climbing={[]} sport="Running" isLoading={false} />);

    expect(screen.queryByText('bestEffortsScreen.climbingBests')).toBeNull();
    expect(screen.getByText('statsScreen.noEffortData')).toBeTruthy();
  });
});

describe('climbStatusOf', () => {
  it('carries both counts of the sport row and zeros when there is none', () => {
    const counted = {
      sports: [],
      climbing: [{ sport: 'Ride', owed: 3, sourceExcluded: 2, bests: [] }],
    } as unknown as BestEffortsData;
    expect(climbStatusOf(counted, 'Cycling')).toEqual({ owed: 3, sourceExcluded: 2 });
    expect(climbStatusOf(counted, 'Running')).toEqual({ owed: 0, sourceExcluded: 0 });
    expect(climbStatusOf(null, 'Cycling')).toEqual({ owed: 0, sourceExcluded: 0 });
  });
});

describe('Season Bests climbing status', () => {
  const emptyBests = climbBestsOf(
    {
      sports: [],
      climbing: [
        {
          sport: 'Run',
          owed: 0,
          sourceExcluded: 0,
          bests: [{ label: '5m', windowS: 300, vam: undefined, wattsPerKg: undefined }],
        },
      ],
    } as unknown as BestEffortsData,
    'Running'
  );

  it('draws the excluded line under the rows only when the count is above zero', () => {
    const { rerender } = render(
      <SeasonBestsSection
        efforts={[]}
        climbing={climbBestsOf(read, 'Running')}
        climbingStatus={{ owed: 0, sourceExcluded: 2 }}
        sport="Running"
        isLoading={false}
      />
    );
    expect(screen.getByTestId('climbing-source-excluded')).toBeTruthy();

    rerender(
      <SeasonBestsSection
        efforts={[]}
        climbing={climbBestsOf(read, 'Running')}
        climbingStatus={{ owed: 0, sourceExcluded: 0 }}
        sport="Running"
        isLoading={false}
      />
    );
    expect(screen.queryByTestId('climbing-source-excluded')).toBeNull();
    expect(screen.queryByTestId('climbing-owed')).toBeNull();
  });

  it('draws the still-computing line when every window is empty and rows are owed', () => {
    render(
      <SeasonBestsSection
        efforts={[]}
        climbing={emptyBests}
        climbingStatus={{ owed: 3, sourceExcluded: 0 }}
        sport="Running"
        isLoading={false}
      />
    );
    expect(screen.getByTestId('climbing-owed')).toBeTruthy();
    expect(screen.getByText('bestEffortsScreen.climbingBests')).toBeTruthy();
    expect(screen.queryByText('statsScreen.noEffortData')).toBeNull();
  });
});
