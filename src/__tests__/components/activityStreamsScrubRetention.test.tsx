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
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import type { ActivityStreams as StreamsData } from '@/types';
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

function rideStreams(): StreamsData {
  const time = new Float64Array(SAMPLES).map((_, i) => i);
  return {
    time,
    distance: time.map((t) => t * 8),
    watts: time.map((t) => 180 + (t % 40)),
  };
}

/** Mounts and lays out a chart over streams only it holds, and hands back a weak handle to them. */
async function mountChart(onPointSelect: jest.Mock) {
  const streams = rideStreams();
  const view = await render(
    <ActivityStreams
      streams={streams}
      elevationGain={0}
      selectedCharts={['power']}
      chartConfigs={CHART_CONFIGS}
      onPointSelect={onPointSelect}
    />
  );
  const box = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  await act(async () => {
    await fireEvent(box!, 'layout', { nativeEvent: { layout: { width: 320, height: 100 } } });
  });
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
  it('reports a scrub index while mounted', async () => {
    const onPointSelect = jest.fn();
    await mountChart(onPointSelect);
    onPointSelect.mockClear();

    scrubTo(10);

    expect(onPointSelect).toHaveBeenCalledWith(expect.any(Number));
  });

  it('reports nothing for a scrub that arrives after unmount', async () => {
    const onPointSelect = jest.fn();
    const chart = await mountChart(onPointSelect);
    scrubTo(10);
    chart.view.unmount();
    onPointSelect.mockClear();

    for (const held of mockHeldByWorklets) held(20);

    expect(onPointSelect).not.toHaveBeenCalled();
  });

  it('lets the closed chart streams be collected', async () => {
    const chart = await mountChart(jest.fn());
    scrubTo(10);

    chart.view.unmount();
    // The reactions stand for the JS side, which unmounting releases. So do
    // jest's mock records, which keep the `this` of every call: a mocked host
    // method called on the unmounted crosshair would otherwise hold it.
    mockReactions.length = 0;
    jest.clearAllMocks();
    await collectGarbage();

    expect(mockHeldByWorklets.length).toBeGreaterThan(0);
    expect(chart.streams.deref()).toBeUndefined();
  });
});
