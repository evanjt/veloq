/**
 * Scenario: a long ride whose second half carries a long descent. intervals.icu
 * stores its decoupling as 3.4%, and its streams split at the sample midpoint
 * give a far larger figure because the coasting zeros pull the second half's
 * power down. The activity screen printed the stored value and the Fitness tab
 * printed the split, graded against a 5% target, with no ride named.
 *
 * Expected behaviour: both surfaces print the stored value, the Fitness card
 * names the ride and its date, and nothing grades the athlete.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { DEFAULT_MAX_HR } from '@/features/activity/lib/hrZones';
import { FitnessTrendSections } from '@/features/fitness/components/sections/FitnessTrendSections';
import { useFitnessScreenData } from '@/features/fitness/hooks/useFitnessScreenData';
import { decouplingSource, storedDecoupling } from '@/features/activity/lib/decoupling';
import { formatRelativeDate } from '@/shared/format/format';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const HALF = 60;
const descentRide = {
  id: 'i-descent',
  type: 'Ride',
  name: 'Col loop',
  start_date_local: '2026-09-05T08:00:00',
  moving_time: 2 * 60 * 60,
  icu_average_watts: 180,
  average_heartrate: 140,
  decoupling: 3.4,
} as Activity;

// Steady first half, then half the second half coasting at zero watts.
const mockDescentStreams = {
  watts: [...Array(HALF).fill(200), ...Array(HALF / 2).fill(200), ...Array(HALF / 2).fill(0)],
  heartrate: Array(HALF * 2).fill(140),
};

let mockActivities: Activity[] = [];
jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [], isLoading: false }),
  timeRangeToDays: () => 42,
}));
jest.mock('@/features/activity/hooks', () => ({
  useActivities: () => ({ data: mockActivities, isLoading: false }),
  // A screen that reads the streams again would split these to 50%.
  useActivityStreams: () => ({ data: mockDescentStreams, isLoading: false }),
  getLatestFTP: () => undefined,
}));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/fitness/hooks/useZoneDistribution', () => ({
  useZoneDistribution: () => ({ data: undefined }),
}));
jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: () => ({ data: undefined }),
}));
jest.mock('@/features/stats/hooks/useSeasonBests', () => ({
  useSeasonBests: () => ({ efforts: [], isLoading: false, headerSummary: undefined }),
}));

function FitnessDecouplingCard() {
  const data = useFitnessScreenData({ timeRange: '1m', sportMode: 'Cycling' });
  return (
    <FitnessTrendSections
      sportMode="Cycling"
      timeRange="1m"
      powerZones={undefined}
      hrZones={undefined}
      zoneCoverage={data.zoneCoverage}
      loadingActivities={false}
      hasActivities
      dominantZone={null}
      zonesExpanded={false}
      onZonesToggle={jest.fn()}
      eftpTrend={undefined}
      ftpTrend={null}
      trendsExpanded={false}
      onTrendsToggle={jest.fn()}
      thresholdPace={undefined}
      runLthr={undefined}
      decouplingSource={data.decouplingSource}
      efficiencyExpanded
      onEfficiencyToggle={jest.fn()}
    />
  );
}

function activityDecouplingRow(activity: Activity) {
  const { result } = renderHook(() =>
    useActivityStats({ activity, isMetric: true, maxHR: DEFAULT_MAX_HR })
  );
  const power = result.current.stats.find((s) => s.title === 'activity.power');
  return power?.details?.find((d) => d.label === 'activity.stats.decoupling')?.value;
}

beforeEach(() => {
  mockActivities = [descentRide];
});

describe('aerobic decoupling', () => {
  it('prints the stored value on the activity screen', () => {
    expect(activityDecouplingRow(descentRide)).toBe('3.4%');
  });

  it('prints the stored value on the Fitness card, not a split of the streams', () => {
    const tree = render(<FitnessDecouplingCard />);

    expect(tree.getAllByText('3.4%').length).toBeGreaterThan(0);
    expect(tree.queryByText(/^(?!3\.4%)-?\d+\.\d%$/)).toBeNull();
  });

  it('names the ride and its date on the Fitness card', () => {
    const tree = render(<FitnessDecouplingCard />);

    expect(tree.getByText(new RegExp(descentRide.name))).toBeTruthy();
    expect(
      tree.getByText(new RegExp(formatRelativeDate(descentRide.start_date_local)))
    ).toBeTruthy();
  });

  it('grades nothing: no verdict badge and no target line', () => {
    const tree = render(<FitnessDecouplingCard />);

    expect(tree.queryByText('stats.goodAerobicFitness')).toBeNull();
    expect(tree.queryByText('stats.needsImprovement')).toBeNull();
    expect(tree.queryByText('stats.targetLessThan5')).toBeNull();
  });

  it('shows the empty state for a library whose rides carry no stored value', () => {
    mockActivities = [{ ...descentRide, decoupling: undefined }];
    const tree = render(<FitnessDecouplingCard />);

    expect(tree.queryByText(/%$/)).toBeNull();
    expect(tree.getByText('stats.noDecouplingData')).toBeTruthy();
  });
});

describe('the stored decoupling reader', () => {
  it('reads a finite number and nothing else', () => {
    expect(storedDecoupling({ decoupling: 3.4 })).toBe(3.4);
    expect(storedDecoupling({ decoupling: -12.5 })).toBe(-12.5);
    expect(storedDecoupling({ decoupling: 0 })).toBe(0);
    expect(storedDecoupling({ decoupling: '-Infinity' })).toBeNull();
    expect(storedDecoupling({ decoupling: Number.NaN })).toBeNull();
    expect(storedDecoupling({ decoupling: null })).toBeNull();
    expect(storedDecoupling({})).toBeNull();
  });

  it('keeps an activity whose stored value is a string off the activity screen', () => {
    const notANumber = { ...descentRide, decoupling: '-Infinity' } as unknown as Activity;
    expect(activityDecouplingRow(notANumber)).toBeUndefined();
  });

  it('picks the newest qualifying ride that carries a stored value', () => {
    const run = { ...descentRide, id: 'run', type: 'Run' } as Activity;
    const short = { ...descentRide, id: 'short', moving_time: 20 * 60 } as Activity;
    const unstored = { ...descentRide, id: 'unstored', decoupling: undefined } as Activity;
    const older = {
      ...descentRide,
      id: 'older',
      name: 'Older ride',
      start_date_local: '2026-08-01T08:00:00',
      decoupling: -1.2,
    } as Activity;

    expect(decouplingSource([run, short, unstored, older])).toEqual({
      activityId: 'older',
      name: 'Older ride',
      date: '2026-08-01T08:00:00',
      decoupling: -1.2,
    });
    expect(decouplingSource([run, short, unstored])).toBeNull();
    expect(decouplingSource(undefined)).toBeNull();
  });
});
