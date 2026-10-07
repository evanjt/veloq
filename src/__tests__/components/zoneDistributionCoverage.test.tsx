/**
 * Scenario: the Training Zones card on a device that has downloaded ninety days
 * of an account with years of rides. Picking a longer range shows "no zone
 * data", or totals that stop where the download did, and says nothing.
 *
 * Expected behaviour: with no zone time and a range never downloaded the card
 * says it is not downloaded, and with zone time over a range partly downloaded
 * it carries a quiet line under the bars.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { RangeCoverage } from 'veloqrs';

import { ZoneDistributionChart } from '@/features/stats/components/ZoneDistributionChart';
import type { ZoneDistribution } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const ZONES: ZoneDistribution[] = [
  { zone: 1, name: 'Recovery', seconds: 600, percentage: 50, color: '#000000' },
  { zone: 2, name: 'Endurance', seconds: 600, percentage: 50, color: '#000000' },
];

describe('ZoneDistributionChart over a range never downloaded', () => {
  it('says the range is not downloaded rather than holding no zone data', () => {
    const view = render(
      <ZoneDistributionChart data={undefined} coverage={RangeCoverage.NotFetched} />
    );

    expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy();
    expect(view.queryByText('stats.noZoneData')).toBeNull();
  });

  it('keeps the empty state for a range the census says is empty', () => {
    const view = render(<ZoneDistributionChart data={[]} coverage={RangeCoverage.Empty} />);

    expect(view.getByText('stats.noZoneData')).toBeTruthy();
    expect(view.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });

  it('adds a quiet line under zone time from a range partly downloaded', () => {
    const view = render(<ZoneDistributionChart data={ZONES} coverage={RangeCoverage.NotFetched} />);

    expect(view.getByTestId('zone-distribution-partial')).toBeTruthy();
  });

  it('carries no line when the range is downloaded', () => {
    const view = render(<ZoneDistributionChart data={ZONES} coverage={RangeCoverage.Loaded} />);

    expect(view.queryByTestId('zone-distribution-partial')).toBeNull();
  });
});
