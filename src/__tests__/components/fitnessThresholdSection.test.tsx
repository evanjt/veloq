/**
 * Scenario: with no run pace and no LTHR the Running block was not rendered at
 * all, which reads as a broken screen rather than as data that has not arrived.
 *
 * Expected behaviour: the section stays, saying there are not enough runs yet.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

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
      loadingActivities={false}
      hasActivities={false}
      dominantZone={null}
      zonesExpanded={false}
      onZonesToggle={jest.fn()}
      eftpHistory={undefined}
      currentFTP={null}
      ftpTrend={null}
      trendsExpanded
      onTrendsToggle={jest.fn()}
      thresholdPace={props.thresholdPace}
      runLthr={props.runLthr}
      decouplingStreams={undefined}
      decouplingValue={null}
      loadingStreams={false}
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

  it('renders the pace it was given', () => {
    const tree = renderRunning({ thresholdPace: 4.2 });

    expect(tree.queryByTestId('fitness-threshold-empty')).toBeNull();
    expect(tree.getAllByText('3:58/km').length).toBeGreaterThan(0);
  });
});
