/**
 * Scenario: all three curve charts draw a dashed rule at the athlete's
 * threshold. The power chart names its rule in a legend and the swim chart
 * names its, and the run pace chart drew the rule with nothing beside it: the
 * critical speed was on screen only inside the model line, among D' and R².
 *
 * Expected behaviour: the pace chart carries the same legend the other two do,
 * naming the critical speed in the athlete's pace unit, and draws none when
 * the curve has no critical speed to mark.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';

interface Curve {
  distances: number[];
  times: number[];
  pace: number[];
  criticalSpeed?: number;
  dPrime?: number;
  r2?: number;
  days?: number;
}

// 3.333 m/s is 5:00/km, which is what the legend has to read.
const mockCurve: { current: Curve } = {
  current: {
    distances: [400, 1000, 5000, 10000],
    times: [80, 220, 1200, 2500],
    pace: [5, 4.55, 4.17, 4],
    criticalSpeed: 3.3333,
    dPrime: 180,
    r2: 0.98,
    days: 42,
  },
};

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: () => ({ data: mockCurve.current, isLoading: false, error: null }),
}));

// The chart names the activity behind the selected point, which is a query of
// its own and not what this is about.
jest.mock('@/features/activity/hooks/useActivities', () => ({
  useActivities: () => ({ data: [], isLoading: false }),
}));

describe('the pace curve threshold legend', () => {
  it('names the critical speed the dashed rule marks', () => {
    render(<PaceCurveChart />);

    expect(screen.getByTestId('pace-curve-cs-legend')).toHaveTextContent(/^CS 5:00\/km$/);
  });

  it('draws no legend for a curve with no critical speed', () => {
    mockCurve.current = { ...mockCurve.current, criticalSpeed: undefined };

    render(<PaceCurveChart />);

    expect(screen.queryByTestId('pace-curve-cs-legend')).toBeNull();
  });
});
