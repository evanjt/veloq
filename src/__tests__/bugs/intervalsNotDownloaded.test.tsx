/**
 * Scenario: an activity whose interval body was never fetched. The hook
 * collapsed `null` into an empty lap list, so the detail screen drew no
 * intervals block at all, exactly as it does for a steady ride with no laps.
 *
 * Expected behaviour: the hook says which of the two it is, and the section
 * says the laps have not been downloaded rather than omitting the block. A card
 * never shows an empty laps block for a body nobody fetched.
 */

import React from 'react';
import { render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import { useActivityIntervals } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';
import type { ActivityDetail, ActivityInterval } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  return {
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DeviceAttribution: () => null,
    ScreenSafeAreaView: View,
  };
});

jest.mock('@/features/activity/components/ChartTypeSelector', () => ({
  ChartTypeSelector: () => null,
}));
jest.mock('@/features/activity/components/CombinedPlot', () => {
  const { View } = require('react-native');
  return { CombinedPlot: () => <View testID="combined-plot" /> };
});
jest.mock('@/features/activity/components/HRZonesChart', () => {
  const { View } = require('react-native');
  return { HRZonesChart: () => <View testID="hr-zones-chart" /> };
});
jest.mock('@/features/activity/components/PowerZonesChart', () => {
  const { View } = require('react-native');
  return { PowerZonesChart: () => <View testID="power-zones-chart" /> };
});
jest.mock('@/features/activity/components/IntervalsTable', () => {
  const { View } = require('react-native');
  return { IntervalsTable: () => <View testID="intervals-table" /> };
});
jest.mock('@/features/activity/components/stats', () => ({ InsightfulStats: () => null }));
jest.mock('@/features/routes', () => ({
  DebugInfoPanel: () => null,
  DebugWarningBanner: () => null,
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));

const engine = {
  getIntervalBody: jest.fn(),
  syncActivityIntervals: jest.fn(),
  subscribe: jest.fn(() => () => {}),
  getBodiesStored: jest.fn(() => 0),
  triggerRefresh: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const intervals: ActivityInterval[] = [
  { type: 'WORK', zone: 3, moving_time: 300, start_index: 0, end_index: 100 },
] as unknown as ActivityInterval[];

function activity(): ActivityDetail {
  return {
    id: 'act-1',
    type: 'Ride',
    name: 'Morning ride',
    start_date_local: '2026-09-12T07:00:00',
  } as unknown as ActivityDetail;
}

function renderSection(props: {
  intervalsData?: { icu_intervals: ActivityInterval[] };
  intervalsOutcome?: 'loaded' | 'empty' | 'pending';
}) {
  return render(
    <ActivityChartsSection
      activity={activity()}
      activityId="act-1"
      streams={undefined}
      intervalsData={props.intervalsData}
      intervalsOutcome={props.intervalsOutcome}
      activityWellness={null}
      coordinates={[]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getIntervalBody.mockReturnValue(null);
});

afterEach(() => {
  client.clear();
});

describe('the intervals hook', () => {
  it('says the body was never fetched rather than handing back empty laps', async () => {
    const { result } = renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
    expect(result.current.data.icu_intervals).toEqual([]);
  });

  it('says a fetched body with no laps is empty', async () => {
    engine.getIntervalBody.mockReturnValue(JSON.stringify({ icu_intervals: [], icu_groups: [] }));

    const { result } = renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('empty'));
  });

  it('says a fetched body with laps is loaded', async () => {
    engine.getIntervalBody.mockReturnValue(
      JSON.stringify({ icu_intervals: intervals, icu_groups: [] })
    );

    const { result } = renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('loaded'));
  });

  /** A body that will not parse is a corrupt row, and re-asking is what fixes it. */
  it('says pending for a body that will not parse', async () => {
    engine.getIntervalBody.mockReturnValue('{not json');

    const { result } = renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
  });
});

describe('the charts section with no intervals', () => {
  it('says the laps were never downloaded when the body is still owed', () => {
    const { getByTestId, queryByTestId } = renderSection({ intervalsOutcome: 'pending' });

    expect(getByTestId('intervals-not-downloaded')).toBeTruthy();
    expect(queryByTestId('activity-interval-table')).toBeNull();
  });

  it('says nothing at all for a ride the server settled as lapless', () => {
    const { queryByTestId } = renderSection({ intervalsOutcome: 'empty' });

    expect(queryByTestId('intervals-not-downloaded')).toBeNull();
    expect(queryByTestId('activity-interval-table')).toBeNull();
  });

  it('draws the table, and no caveat, once the laps are there', () => {
    const { getByTestId, queryByTestId } = renderSection({
      intervalsData: { icu_intervals: intervals },
      intervalsOutcome: 'loaded',
    });

    expect(getByTestId('activity-interval-table')).toBeTruthy();
    expect(queryByTestId('intervals-not-downloaded')).toBeNull();
  });
});
