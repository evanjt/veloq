/**
 * Scenario: the eFTP Trend row headlined the FTP setting beside an arrow and a chart drawn from
 * the daily estimate series.
 *
 * Expected behaviour: the headline is the latest estimate of that series, whatever the setting says.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RangeCoverage } from 'veloqrs';

import { FitnessTrendSections } from '@/features/fitness/components/sections/FitnessTrendSections';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

function renderCycling() {
  return render(
    <FitnessTrendSections
      sportMode="Cycling"
      timeRange="1m"
      powerZones={undefined}
      hrZones={undefined}
      thresholdPace={undefined}
      runLthr={undefined}
      zoneCoverage={RangeCoverage.Loaded}
      loadingActivities={false}
      hasActivities
      dominantZone={null}
      zonesExpanded={false}
      onZonesToggle={jest.fn()}
      eftpTrend={{
        series: [
          { date: '2026-09-01', eftp: 295 },
          { date: '2026-09-02', eftp: 305 },
        ],
        latest: 305,
        previous: 295,
        change: 10,
        changePercent: 3.4,
      }}
      ftpTrend="up"
      trendsExpanded={false}
      onTrendsToggle={jest.fn()}
      decouplingSource={null}
      efficiencyExpanded={false}
      onEfficiencyToggle={jest.fn()}
    />
  );
}

describe('the eFTP Trend row headline', () => {
  it('states the latest estimate of the series its chart and arrow read', () => {
    const tree = renderCycling();

    expect(tree.getAllByText(/305/).length).toBeGreaterThan(0);
  });
});
