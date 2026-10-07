import React from 'react';
import { act, render } from '@testing-library/react-native';
import { TimelineSlider } from '@/features/maps/components/timeline/TimelineSlider';
import { createTimelineLayout } from '@/features/maps/lib/timelineLayout';

interface CapturedGesture {
  handlers?: {
    onBegin?: () => void;
    onUpdate?: (e: { translationX: number }) => void;
    onEnd?: (e: { x: number }) => void;
  };
}

const mockGestures: CapturedGesture[] = [];

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({
      gesture,
      children,
    }: {
      gesture: CapturedGesture;
      children: React.ReactNode;
    }) => {
      mockGestures.push(gesture);
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

const TRACK_WIDTH = 300;
const minDate = new Date('2022-03-10T00:00:00Z');
const maxDate = new Date('2026-01-01T00:00:00Z');
const { dateToPosition, positionToDate, snapPoints } = createTimelineLayout({
  minDate,
  maxDate,
  trackWidth: TRACK_WIDTH,
});
const tick = snapPoints.find((p) => p.kind === 'year' && p.position > 0)!;

describe('TimelineSlider expandOnly start drag', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGestures.length = 0;
  });
  afterEach(() => jest.useRealTimers());

  it('does not snap right of where the drag began', () => {
    const onRangeChange = jest.fn();
    const from = positionToDate(tick.position - 0.02);
    const view = render(
      <TimelineSlider
        minDate={minDate}
        maxDate={maxDate}
        startDate={from}
        endDate={maxDate}
        onRangeChange={onRangeChange}
        expandOnly
      />
    );
    act(() => {
      view.getByTestId('timeline-slider-track').props.onLayout({
        nativeEvent: { layout: { width: TRACK_WIDTH } },
      });
    });
    const begin = dateToPosition(from);
    // Each render captures the track tap, then the start handle, then the end handle.
    const drag = mockGestures[mockGestures.length - 2];
    act(() => {
      drag?.handlers?.onBegin?.();
      drag?.handlers?.onUpdate?.({ translationX: -0.01 * TRACK_WIDTH });
      drag?.handlers?.onEnd?.({ x: 0 });
      jest.advanceTimersByTime(100);
    });
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const [start] = onRangeChange.mock.calls[0];
    expect(dateToPosition(start)).toBeLessThanOrEqual(begin + 1e-6);
  });
});
