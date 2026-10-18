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
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import { useActivityIntervals } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';
import type { EngineBodyStatus } from '@/shared/native/engineBodies';
import { layout } from '@/theme/layout';
import type { ActivityInterval } from '@/types';
import { activityRecord } from '../__shared__/activityRecord';
import { IntervalKind, type ActivityRecord } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui', () => {
  const { View, Pressable, Text } = require('react-native');
  return {
    Card: jest.requireActual('@/shared/ui/Card').Card,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    BodyNotDownloaded: jest.requireActual('@/shared/ui/BodyNotDownloaded').BodyNotDownloaded,
    CardHeader: jest.requireActual('@/shared/ui/CardHeader').CardHeader,
    IconButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PressTarget: require('react-native').Pressable,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DeviceAttribution: () => null,
    DisclosureChevron: () => null,
    ScreenSafeAreaView: View,
  };
});

jest.mock('@/features/activity/components/ChartTypeSelector', () => ({
  ChartTypeSelector: () => null,
}));
jest.mock('@/features/activity/components/ActivityStreams', () => {
  const { View } = require('react-native');
  return { ActivityStreams: () => <View testID="activity-streams" /> };
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
  getActivityIntervals: jest.fn(),
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
  {
    id: 1,
    kind: IntervalKind.Work,
    zone: 3,
    movingTime: 300,
    startTime: 0,
    endTime: 300,
    startIndex: 0,
    endIndex: 100,
  },
];

function activity(): ActivityRecord {
  return activityRecord({
    id: 'act-1',
    sportType: 'Ride',
    name: 'Morning ride',
    startDateLocal: '2026-09-12T07:00:00',
  });
}

function renderSection(props: {
  intervalsData?: ActivityInterval[];
  intervalsOutcome?: 'loaded' | 'empty' | 'pending';
  intervalsStatus?: EngineBodyStatus;
  onRetryIntervals?: () => void;
}) {
  return render(
    <ActivityChartsSection
      activity={activity()}
      activityId="act-1"
      streams={undefined}
      intervalsData={props.intervalsData}
      intervalsOutcome={props.intervalsOutcome}
      intervalsStatus={props.intervalsStatus}
      onRetryIntervals={props.onRetryIntervals}
      activityWellness={null}
      coordinates={[]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      transitionSettled={false}
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
  engine.getActivityIntervals.mockReturnValue(null);
});

afterEach(() => {
  client.clear();
});

describe('the intervals hook', () => {
  it('says the body was never fetched rather than handing back empty laps', async () => {
    const { result } = await renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
    expect(result.current.data).toEqual([]);
  });

  it('says a fetched body with no laps is empty', async () => {
    engine.getActivityIntervals.mockReturnValue({ intervals: [] });

    const { result } = await renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('empty'));
  });

  it('says a fetched body with laps is loaded', async () => {
    engine.getActivityIntervals.mockReturnValue({ intervals });

    const { result } = await renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('loaded'));
    expect(result.current.data).toEqual(intervals);
  });

  it('hands back the wait for a body never fetched, and a retry that asks again', async () => {
    const { result } = await renderHook(() => useActivityIntervals('act-1'), { wrapper });

    await waitFor(() => expect(result.current.bodyStatus).toBe('waiting'));
    expect(engine.syncActivityIntervals).toHaveBeenCalledTimes(1);

    result.current.retryBody();
    await waitFor(() => expect(engine.syncActivityIntervals).toHaveBeenCalledTimes(2));
  });
});

describe('the charts section with no intervals', () => {
  it('says the laps were never downloaded when the body is still owed', async () => {
    const { getByTestId, queryByTestId } = await renderSection({ intervalsOutcome: 'pending' });

    expect(getByTestId('intervals-not-downloaded')).toBeTruthy();
    expect(queryByTestId('activity-interval-table')).toBeNull();
  });

  it.each<EngineBodyStatus>(['timedOut', 'refused'])(
    'offers a Retry that asks again once the wait is %s',
    async (status) => {
      const onRetryIntervals = jest.fn();
      const { getByTestId } = await renderSection({
        intervalsOutcome: 'pending',
        intervalsStatus: status,
        onRetryIntervals,
      });

      await fireEvent.press(getByTestId('intervals-not-downloaded-retry'));
      expect(onRetryIntervals).toHaveBeenCalledTimes(1);
    }
  );

  it('offers no Retry while the laps are still being fetched', async () => {
    const { getByTestId, queryByTestId } = await renderSection({
      intervalsOutcome: 'pending',
      intervalsStatus: 'waiting',
      onRetryIntervals: jest.fn(),
    });

    expect(getByTestId('intervals-not-downloaded')).toBeTruthy();
    expect(queryByTestId('intervals-not-downloaded-retry')).toBeNull();
  });

  it('says nothing at all for a ride the server settled as lapless', async () => {
    const { queryByTestId } = await renderSection({ intervalsOutcome: 'empty' });

    expect(queryByTestId('intervals-not-downloaded')).toBeNull();
    expect(queryByTestId('activity-interval-table')).toBeNull();
  });

  it('draws the table, and no caveat, once the laps are there', async () => {
    const { getByTestId, queryByTestId } = await renderSection({
      intervalsData: intervals,
      intervalsOutcome: 'loaded',
    });

    expect(getByTestId('activity-interval-table')).toBeTruthy();
    expect(queryByTestId('intervals-not-downloaded')).toBeNull();
  });
});

describe('the intervals bar', () => {
  it('reaches the tap-target floor, since the card clips any hit slop', () => {
    const { getByLabelText } = renderSection({
      intervalsData: intervals,
      intervalsOutcome: 'loaded',
    });

    const style = StyleSheet.flatten(
      getByLabelText('activityDetail.tabs.intervals').props.style
    ) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(layout.minTapTarget);
  });
});
