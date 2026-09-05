/**
 * Scenario: the power curve body carries watts per kilogram and the weight
 * they were divided by, and the chart drew watts alone, so the one comparison
 * that survives a change of body weight was one field away and undrawn.
 *
 * Expected behaviour: a curve with a per-kilogram series offers a W/kg toggle
 * that switches the value, the axis and the FTP line together and names the
 * weight behind it. A curve without one offers no toggle.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import type { PowerCurve } from '@/types';

const mockCurve: { current: PowerCurve } = {
  current: {
    type: 'power',
    sport: 'Ride',
    secs: [5, 60, 300, 1200, 3600],
    watts: [800, 500, 350, 300, 260],
    watts_per_kg: [10, 6.25, 4.375, 3.75, 3.25],
    weight: 80,
  },
};

// The chart reads the theme through the app barrel, which reaches the binding.
jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../__shared__/veloqrsStub').withOverrides()
);

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: mockCurve.current, isLoading: false, error: null }),
}));

describe('the power curve per-kilogram toggle', () => {
  it('offers the toggle and shows watts until it is pressed', () => {
    render(<PowerCurveChart ftp={300} />);

    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('260w');
    expect(screen.getByTestId('power-curve-unit-per-kg')).toBeTruthy();
  });

  it('switches the value, the axis and the FTP line to watts per kilogram', () => {
    render(<PowerCurveChart ftp={300} />);

    fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));

    // Under Jest `t` answers with the key, so the unit and the weight line are
    // asserted as keys and the numbers, which sit outside `t`, as numbers.
    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('3.25 units.wattsPerKg');
    expect(screen.getByTestId('power-curve-axis-top')).toHaveTextContent(/units\.wattsPerKg/);
    expect(screen.getByTestId('power-curve-ftp-legend')).toHaveTextContent(/stats\.atWeight/);
  });

  it('switches back to watts', () => {
    render(<PowerCurveChart ftp={300} />);

    fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));
    fireEvent.press(screen.getByTestId('power-curve-unit-watts'));

    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('260w');
    expect(screen.getByTestId('power-curve-ftp-legend')).not.toHaveTextContent(/stats\.atWeight/);
  });

  it('offers no toggle for a curve without a per-kilogram series', () => {
    mockCurve.current = { ...mockCurve.current, watts_per_kg: undefined, weight: undefined };
    render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-unit-per-kg')).toBeNull();
    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('260w');
  });

  it('offers no toggle for a per-kilogram series that is all zero', () => {
    mockCurve.current = { ...mockCurve.current, watts_per_kg: [0, 0, 0, 0, 0], weight: 80 };
    render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-unit-per-kg')).toBeNull();
  });
});
