/**
 * Scenario: the run and swim pace curves print a pace in their header, in the
 * scrubbed point's spoken description, in the threshold's label and in the
 * model footer. The engine writes each of those as text in both unit systems
 * with the curve read.
 *
 * Expected behaviour: every one of them prints the engine's text for the unit
 * system shown, with its unit, and none works a pace out from the speed: the
 * texts here differ from what the speeds would give, and a point or threshold
 * the engine wrote no text for prints the absent mark.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';
import { SwimPaceCurveChart } from '@/features/stats/components/SwimPaceCurveChart';
import { initialiseI18n } from '@/i18n';

interface PaceText {
  metricText: string;
  imperialText: string;
}

interface Curve {
  distances: number[];
  times: number[];
  pace: number[];
  pace_texts: (PaceText | undefined)[];
  criticalSpeed?: number | undefined;
  criticalPace?: PaceText | undefined;
  days: number;
}

const RUN: Curve = {
  distances: [400, 1000, 5000],
  times: [80, 220, 1200],
  pace: [5, 4.55, 4.17],
  pace_texts: [
    { metricText: '7:11', imperialText: '7:12' },
    { metricText: '7:21', imperialText: '7:22' },
    { metricText: '7:31', imperialText: '7:32' },
  ],
  criticalSpeed: 4.1667,
  criticalPace: { metricText: '9:41', imperialText: '9:42' },
  days: 42,
};

const SWIM: Curve = {
  distances: [100, 200, 400],
  times: [70, 150, 320],
  pace: [1.43, 1.33, 1.25],
  pace_texts: [
    { metricText: '5:11', imperialText: '5:12' },
    { metricText: '5:21', imperialText: '5:22' },
    undefined,
  ],
  criticalSpeed: 1.25,
  criticalPace: { metricText: '6:41', imperialText: '6:42' },
  days: 365,
};

const mockPace: { run: Curve; swim: Curve } = { run: RUN, swim: SWIM };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: ({ sport }: { sport: string }) => ({
    data: sport === 'Swim' ? mockPace.swim : mockPace.run,
    isLoading: false,
    error: null,
  }),
}));

interface ChartPoint {
  distance: number;
}

const chartProps: {
  current: {
    data: readonly ChartPoint[];
    describePoint: (point: ChartPoint) => string;
    referenceLine: { label: string } | null;
  } | null;
} = { current: null };

jest.mock('@/shared/charts', () => ({
  ...jest.requireActual('@/shared/charts'),
  CurveChart: (props: NonNullable<typeof chartProps.current>) => {
    chartProps.current = props;
    return null;
  },
}));

function described(distance: number): string {
  const chart = chartProps.current!;
  return chart.describePoint(chart.data.find((p) => p.distance === distance)!);
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  useUnitPreference.setState({ unitPreference: 'metric' });
  mockPace.run = RUN;
  mockPace.swim = SWIM;
  chartProps.current = null;
});

describe('the run pace curve', () => {
  it('prints the engine text in the header, the description and the threshold', async () => {
    await render(<PaceCurveChart />);

    expect(screen.getByText(/^7:31\/km$/)).toBeTruthy();
    expect(described(1000)).toMatch(/7:21\/km$/);
    expect(chartProps.current!.referenceLine!.label).toBe('CS 9:41/km');
    expect(screen.getByText(/^CS 9:41\/km/)).toBeTruthy();
  });

  it('prints the imperial text per mile when imperial', async () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    await render(<PaceCurveChart />);

    expect(screen.getByText(/^7:32\/mi$/)).toBeTruthy();
    expect(described(1000)).toMatch(/7:22\/mi$/);
    expect(chartProps.current!.referenceLine!.label).toBe('CS 9:42/mi');
  });

  it('prints the absent mark where the engine wrote no text', async () => {
    mockPace.run = { ...RUN, pace_texts: [], criticalPace: undefined };
    await render(<PaceCurveChart />);

    expect(screen.getByText(/^--:--\/km$/)).toBeTruthy();
    expect(described(1000)).toMatch(/--:--\/km$/);
    expect(chartProps.current!.referenceLine!.label).toBe('CS --:--/km');
  });
});

describe('the swim pace curve', () => {
  it('prints the engine text in the description and the threshold', async () => {
    await render(<SwimPaceCurveChart />);

    expect(described(100)).toMatch(/5:11\/100m$/);
    expect(chartProps.current!.referenceLine!.label).toBe('CSS 6:41/100m');
  });

  it('prints the imperial text per 100 yd when imperial', async () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    await render(<SwimPaceCurveChart />);

    expect(described(200)).toMatch(/5:22\/100yd$/);
    expect(chartProps.current!.referenceLine!.label).toBe('CSS 6:42/100yd');
  });

  it('prints the header pace of the longest effort, the absent mark where it has no text', async () => {
    await render(<SwimPaceCurveChart />);

    expect(screen.getByText(/^--:--\/100m$/)).toBeTruthy();
  });
});
