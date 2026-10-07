/**
 * Scenario: the feed draws the summary card before the startup bundle has answered.
 *
 * Expected behaviour: the hero value, hero label and each supporting value are
 * animated placeholders, and no '-' is drawn, so a wait cannot be read as missing data.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));

const metrics = [
  { label: 'FTP', value: '-', navigationTarget: '/a' },
  { label: 'Week', value: '-', navigationTarget: '/b' },
];

function card(props: Partial<SummaryCardProps>) {
  return render(
    <SummaryCard
      onProfilePress={() => {}}
      heroValue="-"
      heroLabel="Fitness"
      heroColor="#000"
      showSparkline={false}
      supportingMetrics={metrics}
      {...props}
    />
  );
}

describe('SummaryCard loading', () => {
  it('draws placeholders and no dash while loading', () => {
    const { queryByTestId, queryAllByText } = card({ isLoading: true });
    expect(queryByTestId('summary-card-hero-shimmer')).toBeTruthy();
    expect(queryByTestId('summary-card-hero-label-shimmer')).toBeTruthy();
    expect(queryByTestId('summary-card-metric-0-shimmer')).toBeTruthy();
    expect(queryByTestId('summary-card-metric-1-shimmer')).toBeTruthy();
    expect(queryAllByText('-')).toHaveLength(0);
  });

  it('draws the settled values when not loading', () => {
    const { queryByTestId, queryAllByText } = card({});
    expect(queryByTestId('summary-card-hero-shimmer')).toBeNull();
    expect(queryByTestId('summary-card-metric-0-shimmer')).toBeNull();
    expect(queryAllByText('-').length).toBeGreaterThan(0);
  });
});
