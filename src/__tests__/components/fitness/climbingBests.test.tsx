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

import { ClimbingBestRows } from '@/features/fitness/components/ClimbingBestRows';
import { ClimbingStatusNote } from '@/features/fitness/components/ClimbingStatusNote';
import { climbBestsOf, climbStatusOf } from '@/features/stats/hooks/useSeasonBests';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import type { BestEffortsData } from 'veloqrs';
import { ABSENT } from '@/shared/format/absent';

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const read = {
  sports: [],
  climbing: [
    {
      sport: 'Run',
      owed: 0,
      sourceExcluded: 0,
      bests: [
        {
          label: '15s',
          windowS: 15,
          vam: 1800,
          wattsPerKg: 4.905,
          activityId: 'hill-run',
          activity: { activityId: 'hill-run', name: 'Hill reps', date: 0 },
        },
        { label: '5m', windowS: 300, vam: undefined, wattsPerKg: undefined },
        {
          label: '10m',
          windowS: 600,
          vam: 900,
          wattsPerKg: 2.45,
          activityId: 'hill-run',
          activity: { activityId: 'hill-run', name: 'Hill reps', date: 0 },
        },
      ],
    },
  ],
} as unknown as BestEffortsData;

describe('climbBestsOf', () => {
  it('picks the family of the sport and none for swimming', () => {
    expect(climbBestsOf(read, 'Running').map((b) => b.label)).toEqual(['15 s', '5 min', '10 min']);
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

describe('the climbing rows', () => {
  beforeEach(() => useUnitPreference.setState({ unitPreference: 'metric' }));

  it('draws W/kg for a short window, m/h for a long one and the absent mark for a gap', async () => {
    await render(<ClimbingBestRows bests={climbBestsOf(read, 'Running')} />);

    expect(screen.getByText('4.91 units.wattsPerKg')).toBeTruthy();
    expect(screen.getByText('900 units.metresPerHour')).toBeTruthy();
    expect(screen.getByTestId('season-bests-climbing-300')).toHaveTextContent(`5 min${ABSENT}`, {
      exact: true,
    });
    expect(screen.queryByText(/NaN/)).toBeNull();
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

describe('the climbing status note', () => {
  vaultIt('draws the excluded line only when the count is above zero', async () => {
    const { rerender } = await render(
      <ClimbingStatusNote status={{ owed: 0, sourceExcluded: 2 }} />
    );
    expect(screen.getByTestId('climbing-source-excluded')).toBeTruthy();

    await rerender(<ClimbingStatusNote status={{ owed: 0, sourceExcluded: 0 }} />);
    expect(screen.queryByTestId('climbing-source-excluded')).toBeNull();
    expect(screen.queryByTestId('climbing-owed')).toBeNull();
  });

  vaultIt('draws the still-computing line when rows are owed', async () => {
    await render(<ClimbingStatusNote status={{ owed: 3, sourceExcluded: 0 }} />);
    expect(screen.getByTestId('climbing-owed')).toBeTruthy();
  });
});
