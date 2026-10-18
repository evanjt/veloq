/**
 * Scenario: a chart's value axis sits in a gutter beside its plot, one label per
 * tick centred on the tick's value, in the one axis label style.
 *
 * Expected behaviour: the fitness chart's gutter labels the rounded top of its
 * domain; the form chart puts its zero label on the zero line; every axis label
 * reads the shared style's dark colour in dark mode.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { AttemptHistogramChart } from '@/features/routes/components/section/AttemptHistogramChart';
import { Y_LABEL_BOX } from '@/shared/charts';
import { darkColors } from '@/theme';
import type { WellnessData } from '@/types';
import type { FfiAttemptHistogram } from 'veloqrs';
import { layoutViews } from '../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

let mockDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockDark }),
}));

afterEach(() => {
  mockDark = false;
});

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-04', ctl: 50.5, atl: 40.4 },
] as WellnessData[];

/** Form runs from -20 to +10, inside the chart's fixed -35 to +30 floor. */
const FORM_DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 60 },
  { id: '2026-04-02', ctl: 50, atl: 40 },
] as WellnessData[];

const HISTOGRAM: FfiAttemptHistogram = {
  startSecs: 300,
  binWidthSecs: 30,
  counts: [3, 2, 4],
  binned: 9,
  unbinnedOutsideBand: 0,
};

const HEIGHT = 200;

function colourOf(node: ReactTestInstance) {
  return StyleSheet.flatten(node.props.style).color;
}

function topOf(node: ReactTestInstance) {
  return StyleSheet.flatten(node.props.style).top as number;
}

/** The positioned labels of a gutter, top tick first. */
function gutterLabels(tree: Awaited<ReturnType<typeof render>>, testID: string) {
  return tree.queryAllByTestId(new RegExp(`^${testID}-\\d+$`));
}

describe('the chart value axis', () => {
  it('labels the rounded top of the fitness domain in the gutter', async () => {
    const tree = await render(<FitnessChart data={DAYS} />);
    await layoutViews(tree, 300, HEIGHT);

    const labels = gutterLabels(tree, 'fitness-chart-y-axis').map((n) => n.props.children);
    expect(labels).toEqual(['0', '20', '40', '60']);
  });

  it('centres the form chart zero label on the zero line', async () => {
    const tree = await render(<FormZoneChart data={FORM_DAYS} height={HEIGHT} />);
    await layoutViews(tree, 300, HEIGHT);

    const labels = gutterLabels(tree, 'form-chart-y-axis');
    const zero = labels.find((n) => n.props.children === '0');
    expect(zero).toBeDefined();
    // The domain is -35 to +30 over the plot inside half a label line of padding,
    // above the card's date row, one label line, under the plot.
    const plotTop = Y_LABEL_BOX / 2;
    const plotBottom = HEIGHT - Y_LABEL_BOX / 2 - Y_LABEL_BOX;
    const zeroY = plotTop + (30 / 65) * (plotBottom - plotTop);
    expect(topOf(zero!) + Y_LABEL_BOX / 2).toBeCloseTo(zeroY, 5);
  });

  it('reads the shared secondary colour on every axis label in dark mode', async () => {
    mockDark = true;
    const fitness = await render(<FitnessChart data={DAYS} />);
    await layoutViews(fitness, 300, HEIGHT);
    const form = await render(<FormZoneChart data={FORM_DAYS} height={HEIGHT} />);
    await layoutViews(form, 300, HEIGHT);
    const histogram = await render(
      <AttemptHistogramChart histogram={HISTOGRAM} activityType="Ride" isDark />
    );

    const labels = [
      ...gutterLabels(fitness, 'fitness-chart-y-axis'),
      ...gutterLabels(form, 'form-chart-y-axis'),
      ...histogram.getByTestId('attempt-histogram-x-axis').children,
    ] as ReactTestInstance[];
    expect(labels.length).toBeGreaterThan(6);
    for (const label of labels) expect(colourOf(label)).toBe(darkColors.textSecondary);
  });
});
