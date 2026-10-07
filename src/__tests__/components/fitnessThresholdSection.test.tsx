/**
 * Scenario: with no run pace and no LTHR the Running block was not rendered at
 * all, which reads as a broken screen rather than as data that has not arrived.
 *
 * Expected behaviour: the section stays, saying there are not enough runs yet.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RangeCoverage } from 'veloqrs';

import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { FitnessTrendSections } from '@/features/fitness/components/sections/FitnessTrendSections';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

function renderRunning(props: { thresholdPace?: number; runLthr?: number }) {
  return render(
    <FitnessTrendSections
      sportMode="Running"
      timeRange="1m"
      powerZones={undefined}
      hrZones={undefined}
      zoneCoverage={RangeCoverage.Loaded}
      loadingActivities={false}
      hasActivities={false}
      dominantZone={null}
      zonesExpanded={false}
      onZonesToggle={jest.fn()}
      eftpTrend={undefined}
      ftpTrend={null}
      trendsExpanded
      onTrendsToggle={jest.fn()}
      thresholdPace={props.thresholdPace}
      runLthr={props.runLthr}
      decouplingSource={null}
      efficiencyExpanded={false}
      onEfficiencyToggle={jest.fn()}
    />
  );
}

describe('the running threshold section', () => {
  it('stays on screen with neither a pace nor an LTHR', () => {
    const tree = renderRunning({});

    expect(tree.getByTestId('fitness-section-threshold')).toBeTruthy();
    expect(tree.getByTestId('fitness-threshold-empty')).toBeTruthy();
  });

  it('renders the pace it was given per kilometre when metric', () => {
    useUnitPreference.setState({ unitPreference: 'metric' });
    const tree = renderRunning({ thresholdPace: 4.2 });

    expect(tree.queryByTestId('fitness-threshold-empty')).toBeNull();
    expect(tree.getAllByText('3:58/km').length).toBeGreaterThan(0);
  });

  it('renders the pace it was given per mile when imperial', () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    const tree = renderRunning({ thresholdPace: 4.2 });

    expect(tree.getAllByText('6:23/mi').length).toBeGreaterThan(0);
    expect(tree.queryByText('3:58/km')).toBeNull();
  });
});
