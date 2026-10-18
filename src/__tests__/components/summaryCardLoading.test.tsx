/**
 * Scenario: the feed draws the summary card's place before the startup bundle has answered.
 *
 * Expected behaviour: the skeleton stands in for the whole card and draws no '-', so a wait
 * cannot be read as missing data, and a card that has its values draws them and no skeleton.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SummaryCard, SummaryCardSkeleton } from '@/features/home/components/SummaryCard';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));

const metrics = [
  { label: 'FTP', value: '-', navigationTarget: '/a' },
  { label: 'Week', value: '-', navigationTarget: '/b' },
];

describe('SummaryCard loading', () => {
  it('draws the skeleton and no dash while loading', async () => {
    const { queryByTestId, queryAllByText } = await render(
      <SummaryCardSkeleton heroMetric="fitness" showSparkline supportingCount={2} />
    );
    expect(queryByTestId('summary-card-skeleton')).toBeTruthy();
    expect(queryAllByText('-', { includeHiddenElements: true })).toHaveLength(0);
  });

  it('draws the settled values when not loading', async () => {
    const { queryByTestId, queryAllByText } = await render(
      <SummaryCard
        heroValue="-"
        heroLabel="Fitness"
        showSparkline={false}
        supportingMetrics={metrics}
      />
    );
    expect(queryByTestId('summary-card-skeleton')).toBeNull();
    expect(queryAllByText('-').length).toBeGreaterThan(0);
  });
});
