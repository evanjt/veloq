/**
 * Scenario: the activity chart bridges each scrub index to JavaScript from an
 * animated reaction, and the UI runtime keeps the function that reaction hands
 * over for as long as it keeps the reaction. Captured directly, that function
 * held the chart's data and so the closed activity's streams.
 *
 * Expected behaviour: once the chart unmounts, nothing the UI runtime holds
 * reaches the streams it drew, and a late scrub reports nothing.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { CombinedPlot } from '@/features/activity/components/CombinedPlot';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import type { ActivityStreams } from '@/types';
import { collectGarbage } from '../__shared__/collectGarbage';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

// What the UI runtime keeps: every function a worklet hands to the JS thread.
const mockHeldByWorklets: ((...args: unknown[]) => unknown)[] = [];
// Reactions, so a test can fire one as the UI thread would on a new index.
const mockReactions: ((value: number, previous: number | null) => void)[] = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    useAnimatedReaction: (
      prepare: () => number,
      react: (value: number, previous: number | null) => void,
      deps?: unknown[]
    ) => {
      mockReactions.push(react);
      return actual.useAnimatedReaction(prepare, react, deps);
    },
    runOnJS: (fn: (...args: unknown[]) => unknown) => {
      mockHeldByWorklets.push(fn);
      return fn;
    },
  };
});

const SAMPLES = 600;

function rideStreams(): ActivityStreams {
  const time = new Float64Array(SAMPLES).map((_, i) => i);
  return {
    time,
    distance: time.map((t) => t * 8),
    watts: time.map((t) => 180 + (t % 40)),
  };
}

/** Mounts a chart over streams only it holds, and hands back a weak handle to them. */
function mountChart(onMetricsChange: jest.Mock) {
  const streams = rideStreams();
  const view = render(
    <CombinedPlot
      streams={streams}
      elevationGain={0}
      selectedCharts={['power']}
      chartConfigs={CHART_CONFIGS}
      onMetricsChange={onMetricsChange}
    />
  );
  return { view, streams: new WeakRef(streams) };
}

/** Moves the scrub to `index` through the newest reaction the chart registered. */
function scrubTo(index: number) {
  mockReactions[mockReactions.length - 1](index, null);
}

beforeEach(() => {
  mockHeldByWorklets.length = 0;
  mockReactions.length = 0;
});

describe('the activity chart scrub after the chart closes', () => {
  it('reports a scrub index while mounted', () => {
    const onMetricsChange = jest.fn();
    mountChart(onMetricsChange);
    onMetricsChange.mockClear();

    scrubTo(10);

    expect(onMetricsChange).toHaveBeenCalledWith(expect.any(Array), true);
  });

  it('reports nothing for a scrub that arrives after unmount', () => {
    const onMetricsChange = jest.fn();
    const chart = mountChart(onMetricsChange);
    scrubTo(10);
    chart.view.unmount();
    onMetricsChange.mockClear();

    for (const held of mockHeldByWorklets) held(20);

    expect(onMetricsChange).not.toHaveBeenCalled();
  });

  it('lets the closed chart streams be collected', async () => {
    const chart = mountChart(jest.fn());
    scrubTo(10);

    chart.view.unmount();
    // The reactions stand for the JS side, which unmounting releases.
    mockReactions.length = 0;
    await collectGarbage();

    expect(mockHeldByWorklets.length).toBeGreaterThan(0);
    expect(chart.streams.deref()).toBeUndefined();
  });
});
