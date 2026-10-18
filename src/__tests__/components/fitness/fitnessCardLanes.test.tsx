/**
 * Scenario: the Fitness card stacks the fitness and fatigue plot, the days
 * trained strip and the form plot on one date axis. Each lane named its marks
 * apart from them: a legend of line switches under the plot, a five-dot zone
 * legend whose dots did not match the bands, a date axis under the top lane
 * only, and day strips stacked by sport name with the first one drawn on top.
 *
 * Expected behaviour: the readout is the legend, each value keyed and itself
 * the switch for its line, and the legend row names only the eFTP mark; the
 * form zones are named inside their bands and washed at the tint step; the
 * dates run once, under the form lane; a day stacks its families in their
 * fixed order from the bottom, in the family colours, and a day with no load
 * draws as an outline.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { Rect } from '@shopify/react-native-skia';

import { i18n, initialiseI18n } from '@/i18n';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { formZoneLabel } from '@/features/fitness/lib/fitness';
import type { EftpChange } from '@/features/fitness/lib/eftpChanges';
import { ChartBar } from '@/shared/charts/ChartMarks';
import { formatShortDate } from '@/shared/format/format';
import { colorWithOpacity, colourTokens, opacity, sportFamilyColours } from '@/theme';
import type { WellnessData } from '@/types';
import type { DayActivity } from '@/features/activity/light';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

let mockDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockDark }),
}));

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

afterEach(() => {
  mockDark = false;
});

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-03', ctl: 42, atl: 47 },
] as WellnessData[];

/** Form held at -2, on the grey zone's centre row, clear of every other band's. */
const LEVEL_FORM = [
  { id: '2026-04-01', ctl: 50, atl: 52 },
  { id: '2026-04-02', ctl: 50, atl: 52 },
  { id: '2026-04-03', ctl: 50, atl: 52 },
] as WellnessData[];

const MARKS: EftpChange[] = [
  { date: '2026-04-02', eftp: 251, delta: 6, activityId: 'a1', activityName: 'Hill repeats' },
];

const TALL = 400;

describe('the fitness lane readout and legend', () => {
  it('names only the eFTP mark in the legend row, and only when a mark is drawn', async () => {
    const marked = await render(<FitnessChart data={DAYS} markers={MARKS} />);
    const legend = marked.getByTestId('fitness-chart-legend');
    expect(within(legend).getByTestId('fitness-legend-eftp')).toBeTruthy();
    expect(legend).toHaveTextContent(i18n.t('fitness.eftpChanged'), { exact: true });

    const unmarked = await render(<FitnessChart data={DAYS} />);
    expect(unmarked.queryByTestId('fitness-chart-legend')).toBeNull();
  });

  it.each([
    ['fitness.fitnessCTL' as const, 'fitness-ctl-key', 'fitness-ctl-value'],
    ['fitness.fatigueATL' as const, 'fitness-atl-key', 'fitness-atl-value'],
  ])('makes the %s readout item the keyed switch for its line', async (name, key, value) => {
    const tree = await render(<FitnessChart data={DAYS} />);
    const item = tree.getByRole('switch', { name: i18n.t(name) });

    expect(within(item).getByTestId(key)).toBeTruthy();
    expect(within(item).getByTestId(value)).toBeTruthy();
    await fireEvent.press(item);
    expect(tree.getByRole('switch', { name: i18n.t(name) }).props.accessibilityState).toMatchObject(
      {
        checked: false,
      }
    );
  });

  it('draws no date axis of its own', async () => {
    const tree = await render(<FitnessChart data={DAYS} />);
    await layoutViews(tree, 300, 200);

    // The header names the day it reads; the plot names none.
    const plot = within(tree.getByTestId('fitness-chart-plot'));
    expect(plot.queryByText(formatShortDate('2026-04-01'))).toBeNull();
    expect(plot.queryByText(formatShortDate('2026-04-03'))).toBeNull();
  });
});

describe('the form lane', () => {
  it('names each zone the line leaves room for inside its band, and keeps no legend', async () => {
    const tree = await render(<FormZoneChart data={LEVEL_FORM} height={TALL} />);
    await layoutViews(tree, 300, TALL);

    for (const zone of ['fresh', 'optimal', 'highRisk'] as const) {
      expect(tree.getByTestId(`form-zone-label-${zone}`)).toHaveTextContent(formZoneLabel(zone));
    }
    // The line runs along grey's centre row, so grey stays unnamed.
    expect(tree.queryByTestId('form-zone-label-greyZone')).toBeNull();
    // A name on screen is a band label, never a legend entry beside the plot.
    for (const zone of ['transition', 'fresh', 'greyZone', 'optimal', 'highRisk'] as const) {
      for (const node of tree.queryAllByText(formZoneLabel(zone))) {
        expect(node.props.testID).toBe(`form-zone-label-${zone}`);
      }
    }
  });

  it('places each zone name inside its band', async () => {
    const tree = await render(<FormZoneChart data={LEVEL_FORM} height={TALL} />);
    await layoutViews(tree, 300, TALL);

    const rects = tree.UNSAFE_queryAllByType(Rect);
    const fresh = StyleSheet.flatten(tree.getByTestId('form-zone-label-fresh').props.style);
    // Fresh is the band from +5 to +25: the second band drawn, after transition.
    const band = rects[1].props;
    expect(fresh.top).toBeGreaterThanOrEqual(band.y);
    expect(fresh.top).toBeLessThan(band.y + band.height);
  });

  it.each([
    [false, 'light', opacity.tint2],
    [true, 'dark', opacity.tint3],
  ] as const)(
    'washes the bands in the zone colours at the tint step (dark %s)',
    async (dark, theme, step) => {
      mockDark = dark;
      const tree = await render(<FormZoneChart data={LEVEL_FORM} height={TALL} />);
      await layoutViews(tree, 300, TALL);

      const t = colourTokens[theme];
      const expected = [
        t['data-div-cool-3'],
        t['data-div-cool-1'],
        t['data-div-mid'],
        t['data-div-warm-1'],
        t['data-div-warm-3'],
      ].map((c) => colorWithOpacity(c, step));
      const fills = tree.UNSAFE_queryAllByType(Rect).map((r) => r.props.color);
      expect(fills).toEqual(expected);
    }
  );

  it('carries the card date axis, first and last day', async () => {
    const tree = await render(<FormZoneChart data={LEVEL_FORM} height={TALL} />);
    await layoutViews(tree, 300, TALL);

    const axis = tree.getByTestId('form-chart-date-axis');
    expect(within(axis).getByText(formatShortDate('2026-04-01'))).toBeTruthy();
    expect(within(axis).getByText(formatShortDate('2026-04-03'))).toBeTruthy();
  });
});

describe('the days trained lane', () => {
  const activity = (id: string, type: string, day: string, load = 0): DayActivity =>
    ({
      id,
      name: id,
      type,
      load,
      startDateLocal: `${day}T07:00:00`,
      movingTime: 3600,
      distance: 0,
    }) as DayActivity;
  const WELLNESS = [
    { id: '2026-04-01', ctl: 40, atl: 50 },
    { id: '2026-04-02', ctl: 41, atl: 49 },
  ] as WellnessData[];

  it.each([
    [false, 'light'],
    [true, 'dark'],
  ] as const)('stacks ride under strength in the family colours (dark %s)', async (dark, theme) => {
    mockDark = dark;
    const activities = [
      activity('gym', 'WeightTraining', '2026-04-01', 30),
      activity('ride', 'Ride', '2026-04-01', 60),
    ];
    const tree = await render(<ActivityDotsChart data={WELLNESS} activities={activities} />);
    await layoutViews(tree, 300, 32);

    const bars = tree.UNSAFE_queryAllByType(ChartBar).map((b) => b.props);
    const ride = bars.find((b) => b.color === sportFamilyColours[theme].Ride[0]);
    const strength = bars.find((b) => b.color === sportFamilyColours[theme].Strength[0]);
    expect(ride).toBeDefined();
    expect(strength).toBeDefined();
    // y grows downwards: the bottom portion has the larger top.
    expect(Math.min(ride!.from, ride!.to)).toBeGreaterThan(Math.max(strength!.from, strength!.to));
    expect(tree.getByTestId('fitness-strip-key-Ride')).toBeTruthy();
  });

  it('draws a day trained without load as an outline', async () => {
    const activities = [activity('walk', 'Walk', '2026-04-02')];
    const tree = await render(<ActivityDotsChart data={WELLNESS} activities={activities} />);
    await layoutViews(tree, 300, 32);

    const bars = tree.UNSAFE_queryAllByType(ChartBar).map((b) => b.props);
    expect(bars).toHaveLength(1);
    expect(bars[0].outline).toBe(true);
  });
});
