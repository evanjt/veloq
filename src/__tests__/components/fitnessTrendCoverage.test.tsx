/**
 * Scenario: the eFTP trend, decoupling, wellness trends and fitness charts each
 * told the athlete to complete activities or log wellness whenever they had
 * nothing to draw, including on a device that never downloaded the range.
 *
 * Expected behaviour: given a range the engine says was never downloaded, each
 * says so and gives no instruction; given a range the engine says is empty,
 * each keeps its own empty state.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { RangeCoverage } from 'veloqrs';

import { FTPTrendChart } from '@/features/stats/components/FTPTrendChart';
import { DecouplingChart } from '@/features/stats/components/DecouplingChart';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FitnessTrendSections } from '@/features/fitness/components/sections/FitnessTrendSections';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

describe('the eFTP trend chart', () => {
  it('says a range never downloaded is not downloaded, with no instruction', async () => {
    const view = await render(<FTPTrendChart data={[]} coverage={RangeCoverage.NotFetched} />);

    expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy();
    expect(view.queryByText('stats.completePowerActivities')).toBeNull();
  });

  it('keeps its hint when the range is downloaded and holds no estimate', async () => {
    const view = await render(<FTPTrendChart data={[]} coverage={RangeCoverage.Empty} />);

    expect(view.getByText('stats.noFtpData')).toBeTruthy();
    expect(view.getByText('stats.completePowerActivities')).toBeTruthy();
    expect(view.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });
});

describe('the decoupling chart', () => {
  it('says a range never downloaded is not downloaded, with no instruction', async () => {
    const view = await render(
      <DecouplingChart source={null} coverage={RangeCoverage.NotFetched} />
    );

    expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy();
    expect(view.queryByText('stats.completeDecouplingHint')).toBeNull();
  });

  it('keeps its hint for a range the census says is empty', async () => {
    const view = await render(<DecouplingChart source={null} coverage={RangeCoverage.Empty} />);

    expect(view.getByText('stats.noDecouplingData')).toBeTruthy();
    expect(view.getByText('stats.completeDecouplingHint')).toBeTruthy();
  });
});

describe('the wellness trends chart', () => {
  it('says wellness never downloaded is not downloaded, with no instruction', async () => {
    const view = await render(
      <WellnessTrendsChart data={[]} timeRange="1m" coverage={RangeCoverage.NotFetched} />
    );

    expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy();
    expect(view.queryByText('wellness.trendHint')).toBeNull();
  });

  it('keeps its hint when wellness is downloaded and carries no metric', async () => {
    const view = await render(
      <WellnessTrendsChart
        data={[{ id: '2026-06-01', ctl: 40, atl: 30 }]}
        timeRange="1m"
        coverage={RangeCoverage.Loaded}
      />
    );

    expect(view.getByText('wellness.trendHint')).toBeTruthy();
    expect(view.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });
});

describe('the fitness chart', () => {
  it('says wellness never downloaded is not downloaded', async () => {
    const view = await render(<FitnessChart data={[]} coverage={RangeCoverage.NotFetched} />);

    expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy();
    expect(view.queryByText('fitness.noData')).toBeNull();
  });

  it('keeps its empty state for a range with no stored wellness', async () => {
    const view = await render(<FitnessChart data={[]} coverage={RangeCoverage.Empty} />);

    expect(view.getByText('fitness.noData')).toBeTruthy();
  });
});

describe('the fitness trend sections', () => {
  function sections(eftpCoverage: RangeCoverage, periodCoverage: RangeCoverage) {
    return render(
      <FitnessTrendSections
        sportMode="Cycling"
        timeRange="1m"
        powerZones={undefined}
        hrZones={undefined}
        periodCoverage={periodCoverage}
        loadingActivities={false}
        hasActivities
        dominantZone={null}
        zonesExpanded={false}
        onZonesToggle={jest.fn()}
        eftpTrend={undefined}
        eftpCoverage={eftpCoverage}
        ftpTrend={null}
        trendsExpanded
        onTrendsToggle={jest.fn()}
        thresholdPace={undefined}
        runLthr={undefined}
        decouplingSource={null}
        efficiencyExpanded
        onEfficiencyToggle={jest.fn()}
      />
    );
  }

  it('hands each chart the coverage of the range it draws', async () => {
    const view = await sections(RangeCoverage.NotFetched, RangeCoverage.Empty);

    expect(view.getByTestId('ftp-trend-not-downloaded')).toBeTruthy();
    expect(view.queryByText('stats.completePowerActivities')).toBeNull();
    expect(view.queryByTestId('decoupling-not-downloaded')).toBeNull();
    expect(view.getByText('stats.completeDecouplingHint')).toBeTruthy();
  });

  it('says the decoupling period is not downloaded when the census owes it', async () => {
    const view = await sections(RangeCoverage.Loaded, RangeCoverage.NotFetched);

    expect(view.getByTestId('decoupling-not-downloaded')).toBeTruthy();
    expect(view.queryByText('stats.completeDecouplingHint')).toBeNull();
    expect(view.getByText('stats.completePowerActivities')).toBeTruthy();
  });
});
