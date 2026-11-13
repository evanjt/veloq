/**
 * Scenario: the history slider's handles are dragged while the engine re-renders the panel, which
 * happens often during a download.
 *
 * Expected behaviour: the gesture the detector holds for each handle is the same object across
 * re-renders, so a drag that began on it keeps going and moves the handle the full distance.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { TimelineSlider } from '@/features/maps/components/timeline/TimelineSlider';
import { createTimelineLayout } from '@/features/maps/lib/timelineLayout';

interface CapturedGesture {
  config?: Record<string, number | undefined>;
  handlers?: {
    onBegin?: () => void;
    onUpdate?: (e: { translationX: number }) => void;
    onEnd?: (e: { x: number }) => void;
  };
}

interface Detected {
  testID?: string | undefined;
  gesture: CapturedGesture;
}

const detected: Detected[] = [];

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({
      gesture,
      children,
    }: {
      gesture: CapturedGesture;
      children: React.ReactElement<{ testID?: string }>;
    }) => {
      detected.push({ gesture, testID: children?.props?.testID });
      return children;
    },
  };
});

// Without the worklet transform the animated style cannot track shared values, so evaluate it
// on each render and let the test re-render to read what the shared values now hold.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    useAnimatedStyle: (fn: () => object) => fn(),
  };
});

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
}));

jest.mock('@/features/maps/components/timeline/SyncProgressBanner', () => ({
  SyncProgressBanner: () => null,
}));

const TRACK = 'timeline-slider-track';
const START = 'timeline-slider-start-handle';
const TRACK_WIDTH = 300;
const minDate = new Date('2020-01-01T00:00:00Z');
const maxDate = new Date('2026-01-01T00:00:00Z');
const startDate = new Date('2024-06-01T00:00:00Z');
const layout = createTimelineLayout({ minDate, maxDate, trackWidth: TRACK_WIDTH });

function latest(testID: string): CapturedGesture | undefined {
  return [...detected].reverse().find((d) => d.testID === testID)?.gesture;
}

describe('TimelineSlider gesture stability', () => {
  let onRangeChange: jest.Mock;

  const ui = (activityCount: number) => (
    <TimelineSlider
      minDate={minDate}
      maxDate={maxDate}
      startDate={startDate}
      endDate={maxDate}
      onRangeChange={onRangeChange}
      isLoading
      activityCount={activityCount}
      fixedEnd
      expandOnly
      resetKey={0}
    />
  );

  async function renderLaidOut(activityCount = 0) {
    const view = await render(ui(activityCount));
    await act(() => {
      view.getByTestId(TRACK).props.onLayout({
        nativeEvent: { layout: { width: TRACK_WIDTH } },
      });
    });
    return view;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    detected.length = 0;
    onRangeChange = jest.fn();
  });

  afterEach(() => jest.useRealTimers());

  vaultIt('hands the detector the same gestures across an engine-driven re-render', async () => {
    const view = await renderLaidOut(0);
    const start = latest(START);
    const track = latest(TRACK);

    await view.rerender(ui(1));

    expect(latest(START)).toBe(start);
    expect(latest(TRACK)).toBe(track);
  });

  it('finishes a drag begun before an engine-driven re-render on the same gesture', async () => {
    const view = await renderLaidOut(0);
    const drag = latest(START)!;
    const begin = layout.dateToPosition(startDate);
    const delta = -0.1;
    const expected = layout.snapToNearest(begin + delta, begin).position;

    await act(() => {
      drag.handlers?.onBegin?.();
    });
    await view.rerender(ui(1));

    expect(latest(START)).toBe(drag);

    await act(() => {
      drag.handlers?.onUpdate?.({ translationX: delta * TRACK_WIDTH });
      drag.handlers?.onEnd?.({ x: 0 });
      jest.advanceTimersByTime(100);
    });

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const [start] = onRangeChange.mock.calls[0];
    expect(layout.dateToPosition(start)).toBeCloseTo(expected, 6);
  });

  it('claims a horizontal start-handle drag and yields a vertical one to the sheet', async () => {
    await renderLaidOut(0);
    const config = latest(START)!.config!;

    expect(config.activeOffsetXStart).toBeLessThan(0);
    expect(config.activeOffsetXEnd).toBeGreaterThan(0);
    expect(config.failOffsetYStart).toBeLessThan(0);
    expect(config.failOffsetYEnd).toBeGreaterThan(0);
  });
});
