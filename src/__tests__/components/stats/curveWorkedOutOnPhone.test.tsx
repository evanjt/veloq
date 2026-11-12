/**
 * Scenario: a library read from Garmin files has no server to draw its power
 * and pace curves, so the phone works them out and writes them in the server
 * body's shape.
 *
 * Expected behaviour: a curve the phone worked out says so above the plot and
 * a curve the server sent says nothing, on the power chart and on the pace
 * chart alike.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';
import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import type { PaceCurve, PowerCurve } from '@/types';

const power: { current: PowerCurve } = {
  current: {
    type: 'power',
    sport: 'Ride',
    secs: [5, 60, 300, 1200],
    watts: [800, 500, 350, 300],
    source: 'veloq',
  },
};

const pace: { current: PaceCurve } = {
  current: {
    type: 'pace',
    sport: 'Run',
    distances: [400, 1000, 5000],
    times: [80, 220, 1200],
    pace: [5, 4.55, 4.17],
    source: 'veloq',
  },
};

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: power.current, isLoading: false, error: null }),
}));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: () => ({ data: pace.current, isLoading: false, error: null }),
}));

describe('a curve worked out on the phone', () => {
  it("is labelled as the phone's on the power chart", async () => {
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.getByTestId('power-curve-source')).toBeTruthy();
  });

  it("is labelled as the phone's on the pace chart", async () => {
    await render(<PaceCurveChart />);

    expect(screen.getByTestId('pace-curve-source')).toBeTruthy();
  });

  it('carries no label when the server sent it', async () => {
    power.current = { ...power.current, source: 'intervals' };
    pace.current = { ...pace.current, source: 'intervals' };

    await render(
      <>
        <PowerCurveChart ftp={300} />
        <PaceCurveChart />
      </>
    );

    expect(screen.queryByTestId('power-curve-source')).toBeNull();
    expect(screen.queryByTestId('pace-curve-source')).toBeNull();
  });

  it('carries no label when the curve names no source', async () => {
    const { source: _power, ...plainPower } = power.current;
    const { source: _pace, ...plainPace } = pace.current;
    power.current = plainPower;
    pace.current = plainPace;

    await render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-source')).toBeNull();
  });
});
