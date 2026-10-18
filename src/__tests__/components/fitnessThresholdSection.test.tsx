/**
 * Scenario: with no run pace and no LTHR the Running block was not rendered at
 * all, which reads as a broken screen rather than as data that has not arrived.
 *
 * Expected behaviour: the section stays, and names the inputs the threshold
 * comes from rather than blaming a run count it never checks.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RangeCoverage } from 'veloqrs';

import { initialiseI18n } from '@/i18n';
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
      periodCoverage={RangeCoverage.Loaded}
      dominantZone={null}
      zonesExpanded={false}
      onZonesToggle={jest.fn()}
      eftpTrend={undefined}
      eftpCoverage={RangeCoverage.Loaded}
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
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('stays on screen with neither a pace nor an LTHR', async () => {
    const tree = await renderRunning({});

    expect(tree.getByTestId('fitness-section-threshold')).toBeTruthy();
    expect(tree.getByTestId('fitness-threshold-empty')).toBeTruthy();
  });

  it('names the missing LTHR and pace curve, not a run count, for an athlete with runs', async () => {
    const tree = await renderRunning({});

    const empty = tree.getByTestId('fitness-threshold-empty');
    expect(empty).not.toHaveTextContent(/not enough runs/i);
    expect(empty).toHaveTextContent(/LTHR/);
    expect(empty).toHaveTextContent(/pace curve/i);
  });

  it('renders the pace it was given per kilometre when metric', async () => {
    useUnitPreference.setState({ unitPreference: 'metric' });
    const tree = await renderRunning({ thresholdPace: 4.2 });

    expect(tree.queryByTestId('fitness-threshold-empty')).toBeNull();
    expect(tree.getAllByText('3:58/km').length).toBeGreaterThan(0);
  });

  it('renders the pace it was given per mile when imperial', async () => {
    useUnitPreference.setState({ unitPreference: 'imperial' });
    const tree = await renderRunning({ thresholdPace: 4.2 });

    expect(tree.getAllByText('6:23/mi').length).toBeGreaterThan(0);
    expect(tree.queryByText('3:58/km')).toBeNull();
  });

  it('names critical speed and LTHR under Threshold, not lactate threshold pace', async () => {
    useUnitPreference.setState({ unitPreference: 'metric' });
    const tree = await renderRunning({ thresholdPace: 4.2, runLthr: 172 });

    expect(tree.getByText('Threshold')).toBeTruthy();
    expect(tree.queryByText(/lactate/i)).toBeNull();
    expect(tree.getByText('Critical speed')).toBeTruthy();
    expect(tree.getByText('LTHR')).toBeTruthy();
  });
});
