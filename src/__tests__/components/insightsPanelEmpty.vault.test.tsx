/**
 * Scenario: the insights panel has nothing to list yet.
 *
 * Expected behaviour: it draws the shared EmptyState under the `insights-empty`
 * id the flows read, with its copy from the locale files and no English
 * written into the component.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { InsightsPanel } from '@/features/insights/components/InsightsPanel';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/features/routes', () => ({
  TodayBanner: () => null,
}));
jest.mock('@/features/insights/components/InsightDetailSheet', () => ({
  InsightDetailSheet: () => null,
}));
jest.mock('@/features/insights/components/InsightDebugPanel', () => ({
  InsightDebugPanel: () => null,
}));

describe('the insights panel with no insights', () => {
  it('draws the shared empty state', () => {
    render(<InsightsPanel insights={[]} />);

    expect(screen.getByTestId('insights-empty-title')).toBeTruthy();
  });

  it('reads its copy from the locale files', () => {
    render(<InsightsPanel insights={[]} />);

    expect(screen.getByText('insights.noInsights')).toBeTruthy();
    expect(screen.getByText('insights.noInsightsHint')).toBeTruthy();
  });

  it('reads its failure line from the locale files', () => {
    render(<InsightsPanel insights={[]} failed onRetry={jest.fn()} />);

    expect(screen.getByText('insights.couldNotBuild')).toBeTruthy();
  });
});
