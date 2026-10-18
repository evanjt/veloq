/**
 * Scenario: the power, pace and swim pace curves each draw a dashed rule at
 * the athlete's threshold. The rule was named only in a legend row under the
 * plot, in a grey copied into each chart; the pace axis runs faster at the top
 * with nothing saying so; the pace distance axis read kilometres in every unit
 * setting; and each card shared one fixed height with its header, values and
 * footer, so the plot took what the chrome left.
 *
 * Expected behaviour: the rule is drawn in the reference colour and carries its
 * own label on the line, with no legend row; an inverted pace axis says faster
 * is at the top in its title; the pace axis reads the athlete's distance unit;
 * and the plot is given a height of its own.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Line } from '@shopify/react-native-skia';

import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { CurveChart } from '@/shared/charts/CurveChart';
import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';
import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import { SwimPaceCurveChart } from '@/features/stats/components/SwimPaceCurveChart';
import { initialiseI18n } from '@/i18n';
import { colourTokens } from '@/theme';
import type { PowerCurve } from '@/types';
import { layoutViews } from '../../__shared__/layoutViews';

interface Curve {
  distances: number[];
  times: number[];
  pace: number[];
  criticalSpeed?: number | undefined;
  dPrime?: number | undefined;
  r2?: number | undefined;
  days?: number | undefined;
}

// 4.1667 m/s is 4:00/km and 6:26/mi, inside the plotted paces.
const RUN: Curve = {
  distances: [400, 1000, 5000, 10000],
  times: [80, 220, 1200, 2500],
  pace: [5, 4.55, 4.17, 4],
  criticalSpeed: 4.1667,
  dPrime: 180,
  r2: 0.98,
  days: 42,
};

// 1.25 m/s is 1:20/100m, inside the plotted paces.
const SWIM: Curve = {
  distances: [100, 200, 400, 800],
  times: [70, 150, 320, 680],
  pace: [1.43, 1.33, 1.25, 1.18],
  criticalSpeed: 1.25,
  days: 365,
};

const mockPace: { run: Curve; swim: Curve } = { run: RUN, swim: SWIM };

const mockPower: { current: PowerCurve } = {
  current: {
    type: 'power',
    sport: 'Ride',
    secs: [5, 60, 300, 1200, 3600],
    watts: [800, 500, 350, 300, 260],
  },
};

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: ({ sport }: { sport: string }) => ({
    data: sport === 'Swim' ? mockPace.swim : mockPace.run,
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: mockPower.current, isLoading: false, error: null }),
}));

// The chart names the activity behind the selected point, which is a query of
// its own and not what this is about.
jest.mock('@/features/activity/hooks/useActivities', () => ({
  useActivities: () => ({ data: [], isLoading: false }),
}));

type Tree = Awaited<ReturnType<typeof render>>;

const MIN_PLOT_HEIGHT = 140;

// The solid baseline shares the reference grey in the light theme; the rule is the dashed one.
function referenceRules(tree: Tree) {
  return tree
    .UNSAFE_queryAllByType(Line)
    .map((l) => l.props)
    .filter(
      (p) =>
        p.p1.y === p.p2.y && p.color === colourTokens.light['chart-reference'] && p.children != null
    );
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  useUnitPreference.setState({ unitPreference: 'metric' });
  mockPace.run = RUN;
  mockPace.swim = SWIM;
});

describe('the pace curve threshold', () => {
  it('labels the critical speed on its line, in the reference colour, with no legend row', async () => {
    const tree = await render(<PaceCurveChart />);
    await layoutViews(tree, 320, 200);

    expect(screen.getByTestId('pace-curve-cs-label')).toHaveTextContent(/^CS 4:00\/km$/);
    expect(screen.queryByTestId('pace-curve-cs-legend')).toBeNull();
    expect(referenceRules(tree)).toHaveLength(1);
  });

  it('reads the critical speed per mile when imperial', async () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    const tree = await render(<PaceCurveChart />);
    await layoutViews(tree, 320, 200);

    expect(screen.getByTestId('pace-curve-cs-label')).toHaveTextContent(/^CS 6:26\/mi$/);
  });

  it('draws no rule and no label for a curve with no critical speed', async () => {
    mockPace.run = { ...RUN, criticalSpeed: undefined };
    const tree = await render(<PaceCurveChart />);
    await layoutViews(tree, 320, 200);

    expect(screen.queryByTestId('pace-curve-cs-label')).toBeNull();
    expect(referenceRules(tree)).toHaveLength(0);
  });
});

describe('the pace curve axes', () => {
  it('says faster is at the top of the inverted pace axis', async () => {
    const tree = await render(<PaceCurveChart />);
    await layoutViews(tree, 320, 200);

    expect(screen.getByTestId('pace-curve-plot-axis-title')).toHaveTextContent(
      'min/km, faster at the top'
    );
  });

  it('marks the distance axis in miles for an imperial athlete', async () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    const tree = await render(<PaceCurveChart />);
    await layoutViews(tree, 320, 200);

    expect(screen.getByText('1 mi')).toBeTruthy();
    expect(screen.queryByText('1km')).toBeNull();
    expect(screen.queryByText('1 km')).toBeNull();
  });
});

describe('the curve plot height', () => {
  it.each([
    ['pace', () => <PaceCurveChart />],
    ['swim', () => <SwimPaceCurveChart />],
    ['power', () => <PowerCurveChart ftp={300} />],
  ])('gives the %s plot a height of its own beside the header and footer', async (_, chart) => {
    const tree = await render(chart());

    const plot = tree.UNSAFE_getByType(CurveChart);
    expect(plot.props.plotHeight).toBeGreaterThanOrEqual(MIN_PLOT_HEIGHT);
  });

  it('lays the plot out at the height it was given, whatever its parent leaves', async () => {
    const tree = await render(
      <CurveChart
        testID="plot"
        data={[
          { x: 0, y: 1 },
          { x: 1, y: 2 },
        ]}
        yDomain={[0, 3]}
        color={colourTokens.light['stream-power']}
        xLabels={[]}
        formatY={String}
        plotHeight={MIN_PLOT_HEIGHT}
        reading={{ title: 'Load', xHeader: 'Day', formatX: String, shape: 'series' }}
      />
    );

    const style = StyleSheet.flatten(tree.getByTestId('plot').props.style);
    expect(style.flex).toBeUndefined();
    expect(style.height).toBeGreaterThan(MIN_PLOT_HEIGHT);
  });
});

describe('the power and swim curve thresholds', () => {
  it('labels the FTP on its line and draws no legend row', async () => {
    const tree = await render(<PowerCurveChart ftp={300} />);
    await layoutViews(tree, 320, 200);

    expect(screen.getByTestId('power-curve-ftp-label')).toHaveTextContent('FTP setting 300 W');
    expect(screen.queryByTestId('power-curve-ftp-legend')).toBeNull();
    expect(referenceRules(tree)).toHaveLength(1);
  });

  it('labels the CSS on its line', async () => {
    const tree = await render(<SwimPaceCurveChart />);
    await layoutViews(tree, 320, 200);

    expect(screen.getByTestId('swim-pace-curve-css-label')).toHaveTextContent(/^CSS 1:20\/100m$/);
    expect(referenceRules(tree)).toHaveLength(1);
  });

  it('leaves the label off a rule that falls outside the plotted range', async () => {
    const tree = await render(<PowerCurveChart ftp={2000} />);
    await layoutViews(tree, 320, 200);

    expect(screen.queryByTestId('power-curve-ftp-label')).toBeNull();
    expect(referenceRules(tree)).toHaveLength(0);
  });
});
