/**
 * Scenario: a device whose wellness last synced weeks ago reads a
 * today-anchored window, finds nothing, and the HRV trend falls out of the
 * panel with nothing said.
 *
 * Expected behaviour: one quiet line names the last sync's date, from the
 * engine's `hrvWithheldSince`. Without that field the panel says nothing.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { InsightsPanel } from '@/features/insights/components/InsightsPanel';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/features/routes', () => ({
  TodayBanner: () => null,
}));
jest.mock('@/features/insights/components/InsightDetailSheet', () => ({
  InsightDetailSheet: () => null,
}));
jest.mock('@/features/insights/components/InsightDebugPanel', () => ({
  InsightDebugPanel: () => null,
}));
jest.mock('@/shared/format/format', () => ({
  formatRelativeDate: (d: string) => `formatted:${d}`,
}));

describe('the insights panel when the HRV trend was withheld', () => {
  it('dates the last wellness sync', () => {
    render(<InsightsPanel insights={[]} hrvWithheldSince="2026-08-08" />);

    expect(screen.getByTestId('insights-stale-wellness')).toBeTruthy();
    expect(screen.getByTestId('insights-stale-wellness')).toHaveTextContent(
      'insights.wellnessFromLastSync:{"date":"formatted:2026-08-08"}'
    );
  });

  it('says nothing when no date is given', () => {
    render(<InsightsPanel insights={[]} hrvWithheldSince={null} />);

    expect(screen.queryByTestId('insights-stale-wellness')).toBeNull();
  });

  it('says nothing when the prop is absent', () => {
    render(<InsightsPanel insights={[]} />);

    expect(screen.queryByTestId('insights-stale-wellness')).toBeNull();
  });
});
