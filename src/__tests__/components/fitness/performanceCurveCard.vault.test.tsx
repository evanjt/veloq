/**
 * Scenario: the Performance page opens on its curve, and best efforts live
 * on their own screen behind the header button.
 *
 * Expected behaviour: the curve is a plain card with its title, no collapsed
 * header holds it and no best efforts section sits beneath it.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { PerformanceCurveSection } from '@/features/fitness/components/sections/PerformanceCurveSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats', () => {
  const { View } = require('react-native');
  return {
    usePowerCurve: () => ({ data: { secs: [5, 60] }, isLoading: false, isError: false }),
    usePaceCurve: () => ({ data: { distances: [1000] }, isLoading: false, isError: false }),
    PowerCurveChart: () => <View testID="power-curve-chart" />,
    PaceCurveChart: () => <View testID="pace-curve-chart" />,
    SwimPaceCurveChart: () => <View testID="swim-curve-chart" />,
    CurveFreshnessLine: () => null,
    curveFreshness: () => null,
  };
});

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the performance curve card', () => {
  it.each([
    ['Cycling', 'power-curve-chart', 'Power curve'],
    ['Running', 'pace-curve-chart', 'Pace curve'],
    ['Swimming', 'swim-curve-chart', 'Swim pace curve'],
  ] as const)('draws the %s chart with nothing to expand', async (sportMode, chart, title) => {
    await render(
      <PerformanceCurveSection
        sportMode={sportMode}
        days={30}
        currentFTP={250}
        thresholdPace={undefined}
        swimThresholdPace={undefined}
      />
    );

    expect(screen.getByTestId(chart)).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByTestId('fitness-section-performance')).toBeNull();
    expect(screen.queryByTestId('fitness-section-bests')).toBeNull();
    expect(screen.queryByText('Best efforts')).toBeNull();
  });
});
