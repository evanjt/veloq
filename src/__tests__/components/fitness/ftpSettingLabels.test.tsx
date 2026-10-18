/**
 * Scenario: the Power Curve header, its reference line and the activity's
 * power zone chart print the FTP setting, while the home card prints the daily
 * eFTP. With a 280 W setting and a 251 W estimate the header read a bare
 * "280 W" one row above "eFTP 251 W", naming neither source.
 *
 * Expected behaviour: each surface that prints the setting labels it as the
 * setting, with the value as a formatted power.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { PerformanceCurveSection } from '@/features/fitness/components/sections/PerformanceCurveSection';
import { PowerZonesChart } from '@/features/activity/components/PowerZonesChart';
import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({
    data: { type: 'power', sport: 'Ride', secs: [5, 60, 1200], watts: [800, 500, 300] },
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/features/stats', () => ({
  usePowerCurve: () => ({ data: { secs: [5, 60, 1200] }, isLoading: false, isError: false }),
  usePaceCurve: () => ({ data: { distances: [] }, isLoading: false, isError: false }),
  PowerCurveChart: () => null,
  PaceCurveChart: () => null,
  SwimPaceCurveChart: () => null,
  CurveFreshnessLine: () => null,
  curveFreshness: () => null,
}));

jest.mock('@/features/fitness/components', () => ({ SeasonBestsSection: () => null }));

function renderCyclingSection(currentFTP: number | null) {
  render(
    <PerformanceCurveSection
      sportMode="Cycling"
      days={90}
      timeRange="3m"
      currentFTP={currentFTP}
      thresholdPace={undefined}
      swimThresholdPace={undefined}
      performanceExpanded={false}
      onPerformanceToggle={() => {}}
      bestsExpanded={false}
      onBestsToggle={() => {}}
      bestsEfforts={[]}
      bestsClimbing={[]}
      bestsClimbingStatus={'ready' as never}
      loadingBests={false}
      bestsHeader={null}
    />
  );
}

describe('the FTP setting is labelled as the setting', () => {
  it('in the Power Curve header', () => {
    renderCyclingSection(280);

    expect(screen.getByText('statsScreen.ftpLabel:{"value":"280 W"}')).toBeTruthy();
  });

  it('in the Power Curve header, which states nothing without a setting', () => {
    renderCyclingSection(null);

    expect(screen.queryByText(/statsScreen\.ftpLabel|units\.watts/)).toBeNull();
  });

  it("in the power curve's reference line", async () => {
    const tree = await render(<PowerCurveChart ftp={280} />);
    await layoutViews(tree, 300, 200);

    expect(screen.getByTestId('power-curve-ftp-label')).toHaveTextContent(
      'statsScreen.ftpLabel:{"value":"280 W"}'
    );
  });

  it("in the activity's power zone chart", () => {
    const bands = [
      { zone: 1, minWatts: 0, maxWatts: 150, seconds: 100, percent: 50, share: 50 },
      { zone: 2, minWatts: 150, maxWatts: 200, seconds: 100, percent: 50, share: 50 },
    ];

    render(<PowerZonesChart powerZones={bands} ftp={280} movingTime={200} />);

    expect(screen.getByText('activity.ftp:{"value":"280 W"}')).toBeTruthy();
  });
});
