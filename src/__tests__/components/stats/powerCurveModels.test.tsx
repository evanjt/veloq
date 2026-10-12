/**
 * Scenario: the power curve body carries four fitted critical-power models and
 * the chart drew none of them, so a cyclist saw a list of watts where a runner
 * saw a fitted model.
 *
 * Expected behaviour: every finished fit is named under the curve with its
 * critical power and its W prime. A body with no fits draws no footer rather
 * than a row of zeroes.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import type { PowerCurve } from '@/types';

// Measured on the live account 2026-09-05: the four fits of the 90-day ride
// curve, W prime in joules.
const FITS = [
  { type: 'MS_2P', criticalPower: 119, wPrime: 12799, ftp: 119 },
  { type: 'MORTON_3P', criticalPower: 110, wPrime: 19655, ftp: 110, pMax: 568 },
  { type: 'FFT_CURVES', criticalPower: 137, wPrime: 9720, ftp: 139, pMax: 568 },
  { type: 'ECP', criticalPower: 137, wPrime: 10440, ftp: 137, pMax: 568 },
];

const baseCurve: PowerCurve = {
  type: 'power',
  sport: 'Ride',
  secs: [5, 60, 300, 1200, 3600],
  watts: [800, 500, 350, 300, 260],
  watts_per_kg: [10, 6.25, 4.375, 3.75, 3.25],
  weight: 78.949,
  models: FITS,
};

const mockCurve: { current: PowerCurve } = { current: baseCurve };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: mockCurve.current, isLoading: false, error: null }),
}));

beforeEach(() => {
  mockCurve.current = baseCurve;
});

describe('the fitted critical-power models under the power curve', () => {
  it('names every fit with its critical power and W prime', async () => {
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.getByTestId('power-curve-model-MS_2P')).toHaveTextContent('2P 119 W 12.8 kJ');
    expect(screen.getByTestId('power-curve-model-MORTON_3P')).toHaveTextContent('3P 110 W 19.7 kJ');
    expect(screen.getByTestId('power-curve-model-FFT_CURVES')).toHaveTextContent(
      'FFT 137 W 9.7 kJ'
    );
    expect(screen.getByTestId('power-curve-model-ECP')).toHaveTextContent('ECP 137 W 10.4 kJ');
  });

  it('prints a fit the server names but this build does not know, unabbreviated', async () => {
    mockCurve.current = {
      ...baseCurve,
      models: [{ type: 'OMNI_4P', criticalPower: 150, wPrime: 11000, ftp: 150 }],
    };
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.getByTestId('power-curve-model-OMNI_4P')).toHaveTextContent(
      'OMNI_4P 150 W 11 kJ'
    );
  });

  it('draws no footer for a body carrying no models', async () => {
    mockCurve.current = { ...baseCurve, models: undefined };
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-models')).toBeNull();
  });

  it('draws no footer for a body whose models parsed to none', async () => {
    mockCurve.current = { ...baseCurve, models: [] };
    await render(<PowerCurveChart ftp={300} />);

    expect(screen.queryByTestId('power-curve-models')).toBeNull();
  });

  it('keeps the fits in watts when the curve is read per kilogram', async () => {
    await render(<PowerCurveChart ftp={300} />);

    await fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));

    expect(screen.getByTestId('power-curve-model-ECP')).toHaveTextContent('ECP 137 W 10.4 kJ');
  });
});
