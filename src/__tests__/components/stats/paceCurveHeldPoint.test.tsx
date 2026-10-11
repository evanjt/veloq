/**
 * Scenario: the pace curve keeps the last scrubbed point in its header after
 * the finger lifts. The athlete then turns on GAP or changes the range, and a
 * different curve is drawn.
 *
 * Expected behaviour: a held point belongs to the curve it was scrubbed on.
 * Once another curve is drawn the header reads that curve's longest effort and
 * names its activity, and a held point survives a re-render of the same curve.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';

interface Curve {
  distances: number[];
  times: number[];
  pace: number[];
  activity_ids: string[];
  days: number;
}

interface HeldChartPoint {
  distance: number;
}

const sixWeeks: Curve = {
  distances: [400, 1000, 5000, 10000],
  times: [80, 220, 1200, 2500],
  pace: [5, 4.55, 4.17, 4],
  activity_ids: ['harbour-400', 'harbour-1k', 'harbour-5k', 'harbour-10k'],
  days: 42,
};

const fullYear: Curve = {
  distances: [400, 1000, 5000, 10000, 21097.5],
  times: [78, 215, 1180, 2460, 5400],
  pace: [5.13, 4.65, 4.24, 4.07, 3.91],
  activity_ids: ['ridge-400', 'ridge-1k', 'ridge-5k', 'ridge-10k', 'ridge-half'],
  days: 365,
};

const gradeAdjusted: Curve = {
  distances: [400, 1000, 5000, 15000],
  times: [79, 218, 1190, 3800],
  pace: [5.06, 4.59, 4.2, 3.95],
  activity_ids: ['harbour-400', 'harbour-1k', 'harbour-5k', 'lighthouse-15k'],
  days: 42,
};

const activityNames: Record<string, string> = {
  'harbour-5k': 'Harbour loop',
  'harbour-10k': 'Harbour long loop',
  'ridge-half': 'Ridge half',
  'lighthouse-15k': 'Lighthouse out and back',
};

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// Each query answers with one stable curve object, as the query cache does.
jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: ({ days, gap }: { days: number; gap: boolean }) => ({
    data: gap ? gradeAdjusted : days === 365 ? fullYear : sixWeeks,
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/features/activity/hooks/useActivities', () => {
  const activities = Object.entries(activityNames).map(([id, name]) => ({
    id,
    name,
    start_date_local: '2026-03-01T07:00:00',
  }));
  return { useActivities: () => ({ data: activities, isLoading: false }) };
});

// The scrub gesture lives in the shared chart; this drives the two callbacks
// the pace chart hands it, with the points it was given.
const chartProps: {
  current: {
    data: readonly HeldChartPoint[];
    onSelect: (point: HeldChartPoint) => void;
    onInteractionChange: (active: boolean) => void;
  } | null;
} = { current: null };

jest.mock('@/shared/charts', () => ({
  ...jest.requireActual('@/shared/charts'),
  CurveChart: (props: NonNullable<typeof chartProps.current>) => {
    chartProps.current = props;
    return null;
  },
}));

function scrubTo(distance: number) {
  const chart = chartProps.current!;
  const point = chart.data.find((p) => p.distance === distance)!;
  act(() => {
    chart.onInteractionChange(true);
    chart.onSelect(point);
  });
}

function release() {
  act(() => chartProps.current!.onInteractionChange(false));
}

function expectHeader(distance: number, time: number, activity: string | null) {
  expect(screen.getByText(formatDistance(distance, true))).toBeTruthy();
  expect(screen.getByText(formatDuration(time))).toBeTruthy();
  if (activity) expect(screen.getByLabelText(activity)).toBeTruthy();
}

beforeEach(() => {
  useUnitPreference.setState({ unitPreference: 'metric' });
  chartProps.current = null;
});

describe('the pace curve held point', () => {
  it('stays on screen after release while the same curve is drawn', () => {
    const { rerender } = render(<PaceCurveChart days={42} />);
    scrubTo(5000);
    release();
    rerender(<PaceCurveChart days={42} />);

    expectHeader(5000, 1200, 'Harbour loop');
  });

  it('gives way to the new curve when the range changes', () => {
    const { rerender } = render(<PaceCurveChart days={42} />);
    scrubTo(5000);
    release();
    rerender(<PaceCurveChart days={365} />);

    expectHeader(21097.5, 5400, 'Ridge half');
    expect(screen.queryByText(formatDistance(5000, true))).toBeNull();
    expect(screen.queryByLabelText('Harbour loop')).toBeNull();
  });

  it('gives way to the grade adjusted curve when GAP is turned on', () => {
    render(<PaceCurveChart days={42} />);
    scrubTo(5000);
    release();
    fireEvent(screen.getByRole('switch'), 'valueChange', true);

    expectHeader(15000, 3800, 'Lighthouse out and back');
    expect(screen.queryByText(formatDuration(1200))).toBeNull();
    expect(screen.queryByLabelText('Harbour loop')).toBeNull();
  });

  it('drops a point scrubbed on a curve that was replaced mid-scrub', () => {
    const { rerender } = render(<PaceCurveChart days={42} />);
    scrubTo(5000);
    rerender(<PaceCurveChart days={365} />);

    expectHeader(21097.5, 5400, 'Ridge half');

    release();

    expectHeader(21097.5, 5400, 'Ridge half');
    expect(screen.queryByLabelText('Harbour loop')).toBeNull();
  });

  it('holds a point scrubbed on the new curve after a change', () => {
    const { rerender } = render(<PaceCurveChart days={42} />);
    scrubTo(5000);
    release();
    rerender(<PaceCurveChart days={365} />);
    scrubTo(5000);
    release();

    expectHeader(5000, 1180, null);
  });
});
