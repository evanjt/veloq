/**
 * Scenario: a device whose wellness last synced a month ago reads a
 * today-anchored window, finds nothing, and every form insight falls out of
 * the panel with nothing said.
 *
 * Expected behaviour: one quiet line names the last sync's date. An athlete
 * who has never synced wellness has no sync to date and sees no line.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { InsightsPanel } from '@/features/insights/components/InsightsPanel';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
jest.mock('@/features/routes/components/TodayBanner', () => ({
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

describe('the insights panel when the form cards were dropped', () => {
  it('dates the last wellness sync', () => {
    render(<InsightsPanel insights={[]} todayPattern={null} droppedFormSyncDate="2026-08-08" />);

    expect(screen.getByTestId('insights-stale-form')).toBeTruthy();
    expect(screen.getByTestId('insights-stale-form')).toHaveTextContent(
      'insights.formFromLastSync:{"date":"formatted:2026-08-08"}'
    );
  });

  it('says nothing when wellness has never synced', () => {
    render(<InsightsPanel insights={[]} todayPattern={null} droppedFormSyncDate={null} />);

    expect(screen.queryByTestId('insights-stale-form')).toBeNull();
  });

  it('says nothing when the prop is absent', () => {
    render(<InsightsPanel insights={[]} todayPattern={null} />);

    expect(screen.queryByTestId('insights-stale-form')).toBeNull();
  });
});
