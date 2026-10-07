import React from 'react';
import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { TimelineSlider } from '@/features/maps/components/timeline/TimelineSlider';
import { createTimelineLayout } from '@/features/maps/lib/timelineLayout';

interface CapturedGesture {
  handlers?: { onEnd?: (e: { x: number }) => void; onUpdate?: unknown };
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

const HANDLE_SIZE = 28;
const TRACK_WIDTH = 300;
const minDate = new Date('2020-01-01T00:00:00Z');
const maxDate = new Date('2026-01-01T00:00:00Z');
const startDate = new Date('2024-01-01T00:00:00Z');
const endDate = new Date('2026-01-01T00:00:00Z');

function renderSlider(resetKey: number) {
  const ui = (key: number) => (
    <TimelineSlider
      minDate={minDate}
      maxDate={maxDate}
      startDate={startDate}
      endDate={endDate}
      onRangeChange={jest.fn()}
      resetKey={key}
    />
  );
  const view = render(ui(resetKey));
  act(() => {
    view.getByTestId('timeline-slider-track').props.onLayout({
      nativeEvent: { layout: { width: TRACK_WIDTH } },
    });
  });
  let current = resetKey;
  return {
    view,
    rerenderWith: (key: number) => {
      current = key;
      view.rerender(ui(key));
    },
    settle: () => view.rerender(ui(current)),
  };
}

function startHandleLeft(view: ReturnType<typeof render>): number {
  act(() => {
    jest.advanceTimersByTime(100);
  });
  const style = StyleSheet.flatten(view.getByTestId('timeline-slider-start-handle').props.style);
  return style.left as number;
}

function tapTrack(x: number) {
  const tap = [...mockGestures].reverse().find((g) => g.handlers?.onEnd && !g.handlers?.onUpdate);
  act(() => {
    tap?.handlers?.onEnd?.({ x });
    jest.advanceTimersByTime(100);
  });
}

describe('TimelineSlider resetKey', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGestures.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const committedLeft = () => {
    const { dateToPosition } = createTimelineLayout({ minDate, maxDate, trackWidth: TRACK_WIDTH });
    return dateToPosition(startDate) * TRACK_WIDTH - HANDLE_SIZE / 2;
  };

  it('puts the handle back on the committed range when resetKey changes', () => {
    const { view, rerenderWith, settle } = renderSlider(0);
    settle();
    expect(startHandleLeft(view)).toBeCloseTo(committedLeft());

    tapTrack(20);
    settle();
    expect(startHandleLeft(view)).not.toBeCloseTo(committedLeft());

    rerenderWith(1);
    settle();
    expect(startHandleLeft(view)).toBeCloseTo(committedLeft());
  });

  it('leaves the handle where the gesture put it when resetKey is unchanged', () => {
    const { view, rerenderWith, settle } = renderSlider(0);
    tapTrack(20);
    settle();
    const moved = startHandleLeft(view);

    rerenderWith(0);
    settle();
    expect(startHandleLeft(view)).toBeCloseTo(moved);
  });
});
