/**
 * Scenario: the live GPS accuracy header and the power curve's per-kilogram
 * legend printed metres and kilograms whatever unit the athlete had chosen.
 *
 * Expected behaviour: both follow the unit preference, so an imperial athlete
 * reads feet and pounds and a metric one reads metres and kilograms.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { GpsSignalIndicator } from '@/features/recording/components/GpsSignalIndicator';
import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import type { PowerCurve } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const curve: PowerCurve = {
  type: 'power',
  sport: 'Ride',
  secs: [5, 60, 300, 1200, 3600],
  watts: [800, 500, 350, 300, 260],
  watts_per_kg: [10, 6.25, 4.375, 3.75, 3.25],
  weight: 80,
};

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: curve, isLoading: false, error: null }),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

afterEach(() => {
  useUnitPreference.setState({ unitPreference: 'metric' });
});

describe('the GPS accuracy header', () => {
  it('reads metres for a metric athlete', () => {
    useUnitPreference.setState({ unitPreference: 'metric' });
    render(<GpsSignalIndicator accuracy={12} />);

    expect(screen.getByText('12 m')).toBeTruthy();
  });

  it('reads feet for an imperial athlete', () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    render(<GpsSignalIndicator accuracy={12} />);

    expect(screen.getByText('39 ft')).toBeTruthy();
    expect(screen.queryByText(/m$/)).toBeNull();
  });
});

describe('the power curve per-kilogram legend', () => {
  function showPerKg() {
    render(<PowerCurveChart ftp={300} />);
    fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));
    return screen.getByTestId('power-curve-ftp-legend');
  }

  it('names the weight in kilograms for a metric athlete', () => {
    useUnitPreference.setState({ unitPreference: 'metric' });

    expect(showPerKg()).toHaveTextContent(/at 80 kg$/);
  });

  it('names the weight in pounds for an imperial athlete', () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });

    const legend = showPerKg();
    expect(legend).toHaveTextContent(/at 176 lbs$/);
    expect(legend).not.toHaveTextContent(/\d kg/);
  });
});
