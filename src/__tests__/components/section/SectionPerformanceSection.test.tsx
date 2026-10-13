/**
 * Scenario: the section detail screen narrows the performance chart to a time
 * range and an empty range leaves nothing to plot.
 * Expected behaviour: the range control stays on screen so the user can widen
 * the range again without leaving the screen.
 */

import React, { useMemo, useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  SectionPerformanceSection,
  sectionStreamsState,
} from '@/features/routes/components/section/SectionPerformanceSection';
import { RANGE_DAYS, type SectionTimeRange } from '@/features/routes/constants';
import type { PerformanceDataPoint } from '@/types';
import enGB from '@/i18n/locales/en-GB.json';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

const NOW = new Date('2026-08-30T00:00:00Z').getTime();
const DAY_MS = 86400000;

function effort(daysAgo: number): PerformanceDataPoint & { x: number } {
  return {
    x: 0,
    id: `lap-${daysAgo}`,
    activityId: `act-${daysAgo}`,
    speed: 5,
    date: new Date(NOW - daysAgo * DAY_MS),
    activityName: `Ride ${daysAgo}`,
    direction: 'same',
    sectionTime: 120,
    sectionDistance: 600,
    lapCount: 1,
  } as PerformanceDataPoint & { x: number };
}

/** Mirrors the screen: the range picks which efforts reach the chart. */
function Harness({ efforts }: { efforts: (PerformanceDataPoint & { x: number })[] }) {
  const [range, setRange] = useState<SectionTimeRange>('all');
  const chartData = useMemo(() => {
    const days = RANGE_DAYS[range];
    const inRange =
      days === 0 ? efforts : efforts.filter((e) => e.date.getTime() >= NOW - days * DAY_MS);
    return inRange.map((e, i) => ({ ...e, x: i }));
  }, [efforts, range]);

  return (
    <SectionPerformanceSection
      isDark={false}
      forwardColour="#0D9488"
      sportType="Ride"
      chartData={chartData}
      trendCurves={{}}
      forwardStats={null}
      reverseStats={null}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      onActivitySelect={jest.fn()}
      sectionTimeRange={range}
      onTimeRangeChange={setRange}
    />
  );
}

describe('SectionPerformanceSection time range', () => {
  it('explains that section times include stops beside the performance chart', async () => {
    const { getByTestId } = await render(<Harness efforts={[effort(1)]} />);

    expect(getByTestId('section-time-method').props.children).toBe('sections.timeMethod');
    expect(enGB.sections.timeMethod).toMatch(/elapsed/i);
    expect(enGB.sections.timeMethod).toMatch(/stops/i);
  });
  it('keeps the range control on screen when the chosen range is empty', async () => {
    const { getByTestId, queryByTestId } = await render(<Harness efforts={[effort(200)]} />);

    await fireEvent.press(getByTestId('section-time-range-1m'));

    expect(getByTestId('section-time-range-all')).toBeTruthy();
    expect(queryByTestId('section-performance-empty')).toBeTruthy();

    await fireEvent.press(getByTestId('section-time-range-all'));

    expect(queryByTestId('section-performance-empty')).toBeNull();
  });

  it('survives a second pass through the same empty range', async () => {
    const { getByTestId, queryByTestId } = await render(<Harness efforts={[effort(200)]} />);

    for (const _pass of [0, 1]) {
      await fireEvent.press(getByTestId('section-time-range-1m'));
      expect(queryByTestId('section-performance-empty')).toBeTruthy();
      await fireEvent.press(getByTestId('section-time-range-1y'));
      expect(queryByTestId('section-performance-empty')).toBeNull();
    }
  });

  it('offers the control when the section has no efforts in any range', async () => {
    const { getByTestId, queryByTestId } = await render(<Harness efforts={[]} />);

    expect(queryByTestId('section-performance-empty')).toBeTruthy();
    for (const id of ['1m', '3m', '6m', '1y', 'all']) {
      expect(getByTestId(`section-time-range-${id}`)).toBeTruthy();
    }
  });

  it('plots a single effort rather than treating one point as empty', async () => {
    const { queryByTestId } = await render(<Harness efforts={[effort(1)]} />);

    expect(queryByTestId('section-performance-empty')).toBeNull();
    expect(queryByTestId('section-time-range-all')).toBeTruthy();
  });
});

describe('SectionPerformanceSection while time streams download', () => {
  const base = {
    isDark: false,
    forwardColour: '#0D9488',
    sportType: 'Ride',
    chartData: [],
    trendCurves: {},
    forwardStats: null,
    reverseStats: null,
    bestForwardRecord: null,
    bestReverseRecord: null,
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    onActivitySelect: jest.fn(),
    sectionTimeRange: 'all' as SectionTimeRange,
    onTimeRangeChange: jest.fn(),
  };

  it('draws a placeholder and never the empty state while streams are outstanding', async () => {
    const { queryByTestId } = await render(
      <SectionPerformanceSection {...base} streams={{ status: 'loading', onRetry: jest.fn() }} />
    );

    expect(queryByTestId('section-performance-pending')).toBeTruthy();
    expect(queryByTestId('section-performance-empty')).toBeNull();
    expect(queryByTestId('section-time-range-all')).toBeTruthy();
  });

  it('offers a retry when the stream sync failed and calls it on press', async () => {
    const onRetry = jest.fn();
    const { getByText, queryByTestId } = await render(
      <SectionPerformanceSection
        {...base}
        streams={{ status: 'failed', error: new Error('boom'), onRetry }}
      />
    );

    expect(queryByTestId('section-performance-stream-failure')).toBeTruthy();
    expect(queryByTestId('section-performance-empty')).toBeNull();
    await fireEvent.press(getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the empty state for a settled empty result', async () => {
    const { queryByTestId } = await render(
      <SectionPerformanceSection {...base} streams={{ status: 'ready', onRetry: jest.fn() }} />
    );

    expect(queryByTestId('section-performance-empty')).toBeTruthy();
    expect(queryByTestId('section-performance-pending')).toBeNull();
  });

  it('plots efforts that landed even while the rest download', async () => {
    const { queryByTestId } = await render(
      <SectionPerformanceSection
        {...base}
        chartData={[{ ...effort(1), x: 0 }]}
        streams={{ status: 'loading', onRetry: jest.fn() }}
      />
    );

    expect(queryByTestId('section-performance-pending')).toBeNull();
  });
});

/// Scenario: offline, the wait for the section's time streams ended with two
/// activities still missing, and the chart drew the rest as the whole history.
///
/// Expected behaviour: the screen plots what it has, says how many are not
/// downloaded, and offers a retry, and an empty chart is never "no activities".
describe('SectionPerformanceSection with time streams still missing', () => {
  const base = {
    isDark: false,
    forwardColour: '#0D9488',
    sportType: 'Ride',
    trendCurves: {},
    forwardStats: null,
    reverseStats: null,
    bestForwardRecord: null,
    bestReverseRecord: null,
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    onActivitySelect: jest.fn(),
    sectionTimeRange: 'all' as SectionTimeRange,
    onTimeRangeChange: jest.fn(),
  };

  it('plots what landed, names the count missing and retries on press', async () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText, queryByTestId } = await render(
      <SectionPerformanceSection
        {...base}
        chartData={[{ ...effort(1), x: 0 }]}
        streams={{ status: 'partial', outstanding: 2, onRetry }}
      />
    );

    expect(getByText('sections.effortsNotDownloaded:2')).toBeTruthy();
    expect(getByTestId('section-streams-partial')).toBeTruthy();
    expect(queryByTestId('section-performance-empty')).toBeNull();
    await fireEvent.press(getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not call an empty chart no activities while streams are missing', async () => {
    const { getByTestId, queryByTestId } = await render(
      <SectionPerformanceSection
        {...base}
        chartData={[]}
        streams={{ status: 'partial', outstanding: 1, onRetry: jest.fn() }}
      />
    );

    expect(getByTestId('section-streams-partial')).toBeTruthy();
    expect(queryByTestId('section-performance-empty')).toBeNull();
  });

  it('says nothing about missing streams once every one is stored', async () => {
    const { queryByTestId } = await render(
      <SectionPerformanceSection
        {...base}
        chartData={[{ ...effort(1), x: 0 }]}
        streams={{ status: 'ready', onRetry: jest.fn() }}
      />
    );

    expect(queryByTestId('section-streams-partial')).toBeNull();
  });
});

describe('sectionStreamsState', () => {
  const refetch = jest.fn();
  const sync = { ready: true, error: null, outstanding: 0, refetch };

  it('is partial when the wait ended with streams missing', () => {
    expect(sectionStreamsState({ ...sync, outstanding: 3 })).toEqual({
      status: 'partial',
      outstanding: 3,
      onRetry: refetch,
    });
  });

  it('is ready when nothing is missing', () => {
    expect(sectionStreamsState(sync)).toEqual({ status: 'ready', onRetry: refetch });
  });

  it('is loading until the wait ends', () => {
    expect(sectionStreamsState({ ...sync, ready: false }).status).toBe('loading');
  });

  it('is failed when the sync threw, whatever is missing', () => {
    expect(sectionStreamsState({ ...sync, error: 'boom', outstanding: 2 })).toEqual({
      status: 'failed',
      error: 'boom',
      onRetry: refetch,
    });
  });
});

describe('SectionPerformanceSection for a route', () => {
  const base = {
    subject: 'route' as const,
    isDark: false,
    forwardColour: '#0D9488',
    sportType: 'Ride',
    trendCurves: {},
    forwardStats: null,
    reverseStats: null,
    bestForwardRecord: null,
    bestReverseRecord: null,
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    onActivitySelect: jest.fn(),
    sectionTimeRange: 'all' as const,
    onTimeRangeChange: jest.fn(),
  };

  it('explains that route times use moving time beside the performance chart', async () => {
    const { getByTestId, queryByTestId } = await render(
      <SectionPerformanceSection {...base} chartData={[effort(1)]} />
    );

    expect(getByTestId('route-time-method').props.children).toBe('routes.timeMethod');
    expect(queryByTestId('section-time-method')).toBeNull();
    expect(enGB.routes.timeMethod).toMatch(/moving time/i);
  });

  it('keeps the eye on screen when every attempt is excluded', async () => {
    const onToggleShowExcluded = jest.fn();
    const { getByTestId, getByRole } = await render(
      <SectionPerformanceSection
        {...base}
        chartData={[]}
        hasExcluded
        showExcluded={false}
        onToggleShowExcluded={onToggleShowExcluded}
      />
    );

    expect(getByTestId('section-performance-empty')).toBeTruthy();
    await fireEvent.press(getByRole('button', { name: 'sections.showExcludedActivities' }));
    expect(onToggleShowExcluded).toHaveBeenCalledTimes(1);
  });

  it('offers no eye in an empty range with nothing excluded', async () => {
    const { queryByRole } = await render(
      <SectionPerformanceSection
        {...base}
        chartData={[]}
        hasExcluded={false}
        onToggleShowExcluded={jest.fn()}
      />
    );

    expect(queryByRole('button', { name: 'sections.showExcludedActivities' })).toBeNull();
  });
});
