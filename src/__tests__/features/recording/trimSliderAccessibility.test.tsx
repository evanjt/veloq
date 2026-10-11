/**
 * Scenario: a recording is trimmed on Review without dragging, by a screen reader, Switch
 * Control, a keyboard or the step buttons, and by dragging handles that sit side by side.
 * Expected behaviour: each handle is an adjustable element with the elapsed time as its
 * value, whose actions step it and commit; the buttons step one point; no step crosses the
 * minimum gap or leaves the recording; the handle last moved takes the shared touches; the
 * range text keeps body contrast when trimmed.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TrimSlider } from '@/features/recording/components/TrimSlider';
import { colors } from '@/theme';

interface CapturedGesture {
  config?: { testId?: string };
  handlers?: {
    onStart?: () => void;
    onUpdate?: (e: { translationX: number }) => void;
    onEnd?: () => void;
  };
}

const mockGestures = new Map<string, CapturedGesture>();

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
      if (gesture.config?.testId) mockGestures.set(gesture.config.testId, gesture);
      return children;
    },
  };
});

// Without the worklet transform the animated style cannot track shared values, so evaluate it
// on each render.
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

const TRACK_WIDTH = 240;
const TOTAL_POINTS = 1001;

function setup(props: { startIdx?: number; endIdx?: number; totalPoints?: number } = {}) {
  const onTrimChange = jest.fn();
  const onTrimCommit = jest.fn();
  const view = render(
    <TrimSlider
      totalDuration={1000}
      totalPoints={props.totalPoints ?? TOTAL_POINTS}
      startIdx={props.startIdx ?? 100}
      endIdx={props.endIdx ?? 900}
      onTrimChange={onTrimChange}
      onTrimCommit={onTrimCommit}
    />
  );
  act(() => {
    view.getByTestId('review-trim-track').props.onLayout({
      nativeEvent: { layout: { width: TRACK_WIDTH } },
    });
  });
  const action = (testID: string, actionName: 'increment' | 'decrement') =>
    fireEvent(view.getByTestId(testID), 'accessibilityAction', { nativeEvent: { actionName } });
  return { view, onTrimChange, onTrimCommit, action };
}

beforeEach(() => mockGestures.clear());

describe('TrimSlider handles', () => {
  it('exposes each handle as an adjustable element with the elapsed time as its value', () => {
    const { view } = setup();
    for (const [testID, time] of [
      ['review-trim-start-handle', '1:40'],
      ['review-trim-end-handle', '15:00'],
    ] as const) {
      const handle = view.getByTestId(testID);
      expect(handle.props.accessible).toBe(true);
      expect(handle.props.accessibilityRole).toBe('adjustable');
      expect(handle.props.accessibilityLabel).toBeTruthy();
      expect(handle.props.accessibilityValue.text).toContain(time);
      expect(handle.props.accessibilityActions).toEqual([
        { name: 'increment' },
        { name: 'decrement' },
      ]);
    }
    expect(view.getByTestId('review-trim-start-handle').props.accessibilityLabel).not.toBe(
      view.getByTestId('review-trim-end-handle').props.accessibilityLabel
    );
  });

  it('increment on the start handle moves the start one step and commits it', () => {
    const { onTrimChange, onTrimCommit, action } = setup();
    action('review-trim-start-handle', 'increment');
    expect(onTrimChange).toHaveBeenCalledWith(110, 900);
    expect(onTrimCommit).toHaveBeenCalledWith(110, 900);
  });

  it('decrement on the end handle moves the end one step earlier and commits it', () => {
    const { onTrimChange, onTrimCommit, action } = setup();
    action('review-trim-end-handle', 'decrement');
    expect(onTrimChange).toHaveBeenCalledWith(100, 890);
    expect(onTrimCommit).toHaveBeenCalledWith(100, 890);
  });

  it('a step that cannot move the bound reports nothing', () => {
    const { onTrimChange, onTrimCommit, action } = setup({ startIdx: 0, endIdx: 1000 });
    action('review-trim-start-handle', 'decrement');
    action('review-trim-end-handle', 'increment');
    expect(onTrimChange).not.toHaveBeenCalled();
    expect(onTrimCommit).not.toHaveBeenCalled();
  });

  it('stops a step at one handle width from the other bound', () => {
    // 28 dp of a 240 dp track over 1000 intervals is 117 points, wider than 5 per cent.
    const { onTrimChange, action } = setup({ startIdx: 380, endIdx: 500 });
    action('review-trim-start-handle', 'increment');
    expect(onTrimChange).toHaveBeenCalledWith(383, 500);
  });
});

describe('TrimSlider step buttons', () => {
  it('moves each bound by one point and commits it', () => {
    const { view, onTrimChange, onTrimCommit } = setup();
    fireEvent.press(view.getByTestId('review-trim-start-earlier'));
    expect(onTrimCommit).toHaveBeenLastCalledWith(99, 900);
    fireEvent.press(view.getByTestId('review-trim-start-later'));
    expect(onTrimCommit).toHaveBeenLastCalledWith(101, 900);
    fireEvent.press(view.getByTestId('review-trim-end-earlier'));
    expect(onTrimCommit).toHaveBeenLastCalledWith(100, 899);
    fireEvent.press(view.getByTestId('review-trim-end-later'));
    expect(onTrimCommit).toHaveBeenLastCalledWith(100, 901);
    expect(onTrimChange).toHaveBeenCalledTimes(4);
  });

  it('labels every button and disables the ones that cannot move', () => {
    const { view } = setup({ startIdx: 0, endIdx: 1000 });
    for (const testID of [
      'review-trim-start-earlier',
      'review-trim-start-later',
      'review-trim-end-earlier',
      'review-trim-end-later',
    ]) {
      const button = view.getByTestId(testID);
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.accessibilityLabel).toBeTruthy();
    }
    expect(view.getByTestId('review-trim-start-earlier').props.accessibilityState.disabled).toBe(
      true
    );
    expect(view.getByTestId('review-trim-end-later').props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('review-trim-start-later').props.accessibilityState.disabled).toBe(
      false
    );
  });
});

describe('TrimSlider drag', () => {
  // runOnJS hands its call to a timer, as the worklet hop does on a device.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('holds a dragged start one handle width from the end rather than under it', () => {
    const { onTrimChange, onTrimCommit } = setup({ startIdx: 100, endIdx: 900 });
    const drag = mockGestures.get('review-trim-start-gesture');
    act(() => {
      drag?.handlers?.onStart?.();
      drag?.handlers?.onUpdate?.({ translationX: TRACK_WIDTH });
      drag?.handlers?.onEnd?.();
      jest.runOnlyPendingTimers();
    });
    expect(onTrimChange).toHaveBeenLastCalledWith(783, 900);
    expect(onTrimCommit).toHaveBeenLastCalledWith(783, 900);
  });

  it('puts the handle last moved above the other so it takes the shared touches', () => {
    const { view, action } = setup();
    const zIndex = (testID: string) =>
      StyleSheet.flatten(view.getByTestId(testID).props.style).zIndex ?? 0;
    expect(zIndex('review-trim-end-handle')).toBeGreaterThan(zIndex('review-trim-start-handle'));

    act(() => {
      mockGestures.get('review-trim-start-gesture')?.handlers?.onStart?.();
      jest.runOnlyPendingTimers();
    });
    expect(zIndex('review-trim-start-handle')).toBeGreaterThan(zIndex('review-trim-end-handle'));

    action('review-trim-end-handle', 'decrement');
    expect(zIndex('review-trim-end-handle')).toBeGreaterThan(zIndex('review-trim-start-handle'));
  });
});

describe('TrimSlider range text', () => {
  it('draws the trimmed range in the primary text colour', () => {
    const { view } = setup();
    const text = view.getByTestId('review-trim-range');
    expect(StyleSheet.flatten(text.props.style).color).toBe(colors.textPrimary);
  });
});
