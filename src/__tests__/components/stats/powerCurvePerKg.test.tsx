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
import { layout } from '@/theme';
import type { PowerCurve } from '@/types';
import { layoutViews } from '../../__shared__/layoutViews';

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
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: mockCurve.current, isLoading: false, error: null }),
}));

describe('the power curve per-kilogram toggle', () => {
  it('offers the toggle and shows watts until it is pressed', async () => {
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('260 W');
    expect(screen.getByTestId('power-curve-unit-per-kg')).toBeTruthy();
  });

  it('draws the pair as selectable buttons that each reach the tap-target minimum', async () => {
    await render(<PowerCurveChart ftp={300} />);

    for (const [testID, selected] of [
      ['power-curve-unit-watts', true],
      ['power-curve-unit-per-kg', false],
    ] as const) {
      const pill = screen.getByTestId(testID);
      const flat = Object.assign({}, ...[pill.props.style].flat(Infinity).filter(Boolean));
      const slop = pill.props.hitSlop ?? {};
      expect(pill.props.accessibilityRole).toBe('button');
      expect(pill.props.accessibilityState).toMatchObject({ selected });
      expect(
        Number(flat.minHeight ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0)
      ).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('switches the value, the axis and the FTP line to watts per kilogram', async () => {
    const tree = await render(<PowerCurveChart ftp={300} />);
    await layoutViews(tree, 300, 200);

    await fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));

    // Under Jest `t` answers with the key, so the unit and the weight line are
    // asserted as keys and the numbers, which sit outside `t`, as numbers.
    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('3.25 units.wattsPerKg');
    expect(screen.getByTestId('power-curve-axis-top')).toHaveTextContent(/units\.wattsPerKg/);
    expect(screen.getByTestId('power-curve-ftp-label')).toHaveTextContent(
      /statsScreen\.ftpLabelAtWeight/
    );
  });

  it('switches back to watts', async () => {
    const tree = await render(<PowerCurveChart ftp={300} />);
    await layoutViews(tree, 300, 200);

    await fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));
    await fireEvent.press(screen.getByTestId('power-curve-unit-watts'));

    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('260 W');
    expect(screen.getByTestId('power-curve-ftp-label')).not.toHaveTextContent(/stats\.atWeight/);
  });

  it('offers no toggle for a curve without a per-kilogram series', async () => {
    mockCurve.current = { ...mockCurve.current, watts_per_kg: undefined, weight: undefined };
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-unit-per-kg')).toBeNull();
    expect(screen.getByTestId('power-curve-watts')).toHaveTextContent('260 W');
  });

  it('offers no toggle for a per-kilogram series that is all zero', async () => {
    mockCurve.current = { ...mockCurve.current, watts_per_kg: [0, 0, 0, 0, 0], weight: 80 };
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-unit-per-kg')).toBeNull();
  });
});
