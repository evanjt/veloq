/**
 * Scenario: the activity strip under the fitness plot sits above the form plot on one phone
 * screen, so it carries no title, no day-activity row, no load text, no gloss sentence and no
 * Show data link of its own.
 *
 * Expected behaviour: the strip is its marks and a legend of one icon per sport family, each icon
 * named for a screen reader and none printing text. The strip stays a labelled chart for a screen
 * reader, and a window of rest days has no legend.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import type { FeedCard, WellnessData } from '@/types';
import { dayActivityRow } from '@/features/activity/light';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const WELLNESS = [
  { id: '2026-03-10', ctl: 40, atl: 50 },
  { id: '2026-03-11', ctl: 41, atl: 49 },
  { id: '2026-03-12', ctl: 42, atl: 48 },
] as WellnessData[];

function activity(id: string, day: string): FeedCard {
  return {
    id,
    name: `Ride ${id}`,
    sportType: 'Ride',
    startDateLocal: `${day}T07:00:00`,
  } as FeedCard;
}

const withLoad = (a: FeedCard, sport: FeedCard['sportType'], load: number): FeedCard =>
  ({ ...a, sportType: sport, trainingLoad: load }) as FeedCard;

function strip(selectedDate: string | null, activities: FeedCard[]) {
  return (
    <ActivityDotsChart
      data={WELLNESS}
      activities={activities.map(dayActivityRow)}
      dailyLoads={[]}
      selectedDate={selectedDate}
    />
  );
}

const MIXED = [
  withLoad(activity('r1', '2026-03-10'), 'Ride', 50),
  withLoad(activity('u1', '2026-03-11'), 'Run', 30),
  withLoad(activity('w1', '2026-03-12'), 'Walk', 0),
];

describe('the activity strip', () => {
  it('prints no title, day row, load text, gloss or Show data link', async () => {
    const tree = await render(strip('2026-03-10', MIXED));

    expect(tree.queryByText(/fitness\.daysTrained/)).toBeNull();
    expect(tree.queryByRole('header')).toBeNull();
    expect(tree.queryByTestId('fitness-day-load')).toBeNull();
    expect(tree.queryByTestId('fitness-strip-gloss')).toBeNull();
    expect(tree.queryByTestId('activity-dots-plot-show-data')).toBeNull();
    expect(tree.queryByText(/metrics\.trainingLoad/)).toBeNull();
  });

  it('keys each sport family and the no-load state as a named icon with no visible text', async () => {
    const tree = await render(strip(null, MIXED));

    expect(tree.getByLabelText('sportFamilies.ride')).toBeTruthy();
    expect(tree.getByLabelText('sportFamilies.run')).toBeTruthy();
    expect(tree.getByLabelText('fitness.noLoadKey')).toBeTruthy();
    expect(tree.queryByText(/sportFamilies\./)).toBeNull();
    expect(tree.queryByText(/fitness\.noLoadKey/)).toBeNull();
    expect(tree.queryByLabelText('sportFamilies.foot')).toBeNull();
  });

  it('keeps the legend through selecting and clearing a day', async () => {
    const tree = await render(strip('2026-03-10', MIXED));
    expect(tree.getByTestId('fitness-strip-key-Run')).toBeTruthy();

    await tree.rerender(strip(null, MIXED));
    expect(tree.getByTestId('fitness-strip-key-Run')).toBeTruthy();
  });

  it('keys sports of one group as that group, once', async () => {
    const tree = await render(
      strip(null, [
        withLoad(activity('r1', '2026-03-10'), 'Ride', 50),
        withLoad(activity('v1', '2026-03-11'), 'VirtualRide', 40),
        withLoad(activity('g1', '2026-03-12'), 'GravelRide', 30),
      ])
    );

    expect(tree.getByTestId('fitness-strip-key-Ride')).toBeTruthy();
    expect(tree.queryByTestId('fitness-strip-key-VirtualRide')).toBeNull();
    expect(tree.queryByTestId('fitness-strip-key-GravelRide')).toBeNull();
  });

  it('omits sports and the no-load entry that the window does not show', async () => {
    const tree = await render(strip(null, [withLoad(activity('r1', '2026-03-10'), 'Ride', 50)]));

    expect(tree.getByTestId('fitness-strip-key-Ride')).toBeTruthy();
    expect(tree.queryByTestId('fitness-strip-key-Run')).toBeNull();
    expect(tree.queryByTestId('fitness-strip-key-noLoad')).toBeNull();
  });

  it('has no legend on a window of rest days', async () => {
    const tree = await render(strip(null, []));

    expect(tree.queryByTestId('fitness-strip-key-Ride')).toBeNull();
    expect(tree.queryByTestId('fitness-strip-key-noLoad')).toBeNull();
  });
});
