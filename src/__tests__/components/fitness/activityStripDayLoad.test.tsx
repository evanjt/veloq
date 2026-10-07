/**
 * Scenario: the activity strip under the fitness plot names the selected day's
 * activities but not what they add up to; load shows only per activity inside
 * the picker.
 *
 * Expected behaviour: the selected day's recorded training load reads beside
 * the label without opening the picker, including on a single-activity day. A
 * day whose activities carry no load reads unavailable, a day with only some
 * reads partial, and a change of selection never carries the previous total.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { DayLoadStatus, type DayLoad } from 'veloqrs';
import type { Activity, WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const WELLNESS = [
  { id: '2026-03-10', ctl: 40, atl: 50 },
  { id: '2026-03-11', ctl: 41, atl: 49 },
  { id: '2026-03-12', ctl: 42, atl: 48 },
  { id: '2026-03-13', ctl: 43, atl: 47 },
  { id: '2026-03-14', ctl: 44, atl: 46 },
] as WellnessData[];

function activity(id: string, day: string): Activity {
  return {
    id,
    name: `Ride ${id}`,
    type: 'Ride',
    start_date_local: `${day}T07:00:00`,
  } as Activity;
}

const ACTIVITIES = [
  activity('a1', '2026-03-10'),
  activity('a2', '2026-03-10'),
  activity('b1', '2026-03-11'),
  activity('b2', '2026-03-11'),
  activity('c1', '2026-03-12'),
  activity('d1', '2026-03-13'),
];

const LOADS: DayLoad[] = [
  { date: '2026-03-10', status: DayLoadStatus.Complete, total: 100, activityCount: 2 },
  { date: '2026-03-11', status: DayLoadStatus.Partial, total: 40, activityCount: 2 },
  { date: '2026-03-12', status: DayLoadStatus.Unavailable, activityCount: 1 },
  { date: '2026-03-13', status: DayLoadStatus.Complete, total: 0, activityCount: 1 },
];

function strip(selectedDate: string | null) {
  return (
    <ActivityDotsChart
      data={WELLNESS}
      activities={ACTIVITIES}
      dailyLoads={LOADS}
      selectedDate={selectedDate}
    />
  );
}

describe('the activity strip selected-day load', () => {
  it('reads the total of a complete day without opening the picker', () => {
    const tree = render(strip('2026-03-10'));

    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/100/);
    expect(tree.getByTestId('fitness-day-load')).not.toHaveTextContent(/fitness\.loadPartial/);
  });

  it('marks a partial day as partial and keeps its known total', () => {
    const tree = render(strip('2026-03-11'));

    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/40/);
    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/fitness\.loadPartial/);
  });

  it('reads unavailable, never a zero, for a day whose activities carry no load', () => {
    const tree = render(strip('2026-03-12'));

    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/fitness\.loadUnavailable/);
    expect(tree.getByTestId('fitness-day-load')).not.toHaveTextContent(/\b0\b/);
  });

  it('reads an explicit zero as a known zero', () => {
    const tree = render(strip('2026-03-13'));

    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/\b0\b/);
    expect(tree.getByTestId('fitness-day-load')).not.toHaveTextContent(/fitness\.loadUnavailable/);
  });

  it('prints nothing on a rest day', () => {
    const tree = render(strip('2026-03-14'));

    expect(tree.queryByTestId('fitness-day-load')).toBeNull();
  });

  it('follows the selected date and carries no total into the next selection', () => {
    const tree = render(strip('2026-03-10'));
    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/100/);

    tree.rerender(strip('2026-03-12'));
    expect(tree.getByTestId('fitness-day-load')).toHaveTextContent(/fitness\.loadUnavailable/);
    expect(tree.getByTestId('fitness-day-load')).not.toHaveTextContent(/100/);

    tree.rerender(strip('2026-03-14'));
    expect(tree.queryByTestId('fitness-day-load')).toBeNull();

    tree.rerender(strip(null));
    expect(tree.queryByTestId('fitness-day-load')).toBeNull();
  });
});

describe('the activity strip title and key', () => {
  const MIXED_WELLNESS = [
    { id: '2026-03-10', ctl: 40, atl: 50 },
    { id: '2026-03-11', ctl: 41, atl: 49 },
    { id: '2026-03-12', ctl: 42, atl: 48 },
  ] as WellnessData[];

  function mixed(selectedDate: string | null, activities: Activity[]) {
    return (
      <ActivityDotsChart
        data={MIXED_WELLNESS}
        activities={activities}
        dailyLoads={[]}
        selectedDate={selectedDate}
      />
    );
  }

  const withLoad = (a: Activity, type: Activity['type'], load: number): Activity =>
    ({ ...a, type, icu_training_load: load }) as Activity;

  const MIXED = [
    withLoad(activity('r1', '2026-03-10'), 'Ride', 50),
    withLoad(activity('u1', '2026-03-11'), 'Run', 30),
    withLoad(activity('w1', '2026-03-12'), 'Walk', 0),
  ];

  it('titles the strip as a header and keys both sports and the neutral state', () => {
    const tree = render(mixed(null, MIXED));

    expect(tree.getByRole('header')).toHaveTextContent(/fitness\.daysTrained/);
    expect(tree.getByTestId('fitness-strip-key-Ride')).toHaveTextContent(/Ride/);
    expect(tree.getByTestId('fitness-strip-key-Run')).toHaveTextContent(/Run/);
    expect(tree.queryByTestId('fitness-strip-key-Walk')).toBeNull();
    expect(tree.getByTestId('fitness-strip-key-noLoad')).toHaveTextContent(/fitness\.noLoadKey/);
    expect(tree.getByTestId('fitness-strip-gloss')).toHaveTextContent(/fitness\.stripGloss/);
  });

  it('keeps the title and key through selecting and clearing a day', () => {
    const tree = render(mixed('2026-03-10', MIXED));
    expect(tree.getByRole('header')).toHaveTextContent(/fitness\.daysTrained/);
    expect(tree.getByTestId('fitness-strip-key-Run')).toBeTruthy();

    tree.rerender(mixed(null, MIXED));
    expect(tree.getByRole('header')).toHaveTextContent(/fitness\.daysTrained/);
    expect(tree.getByTestId('fitness-strip-key-Run')).toBeTruthy();
  });

  it('omits sports and the neutral entry that the window does not show', () => {
    const tree = render(mixed(null, [withLoad(activity('r1', '2026-03-10'), 'Ride', 50)]));

    expect(tree.getByTestId('fitness-strip-key-Ride')).toBeTruthy();
    expect(tree.queryByTestId('fitness-strip-key-Run')).toBeNull();
    expect(tree.queryByTestId('fitness-strip-key-noLoad')).toBeNull();
  });

  it('keeps the title with no key on a window of rest days', () => {
    const tree = render(mixed(null, []));

    expect(tree.getByRole('header')).toHaveTextContent(/fitness\.daysTrained/);
    expect(tree.queryByTestId('fitness-strip-gloss')).toBeNull();
  });
});
