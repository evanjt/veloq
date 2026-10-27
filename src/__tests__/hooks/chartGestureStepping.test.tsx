/**
 * Scenario: a screen reader, switch or keyboard user meets a chart whose only
 * way to a day's values is a hold and a drag, which none of them can make.
 *
 * Expected behaviour: the scrub hook exposes one adjustable element that steps
 * the selection by one sample, or by a tenth of the series, clamped at both
 * ends, through the same selection a touch makes, with no haptic per step and
 * no scrub left open behind it.
 */

import { AccessibilityInfo, Platform, type AccessibilityActionEvent } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { useChartGestures, type ChartGestureOptions } from '@/shared/charts/useChartGestures';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

interface Day {
  x: number;
  day: string;
}

const days = (n: number): Day[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, day: `day ${i + 1}` }));

function renderChart(options: Partial<ChartGestureOptions<Day>> & { data: Day[] }) {
  return renderHook(() =>
    useChartGestures<Day>({
      accessibilityLabel: 'Kiln heat',
      describePoint: (point) => point.day,
      ...options,
    })
  );
}

type Result = ReturnType<typeof renderChart>['result'];

async function act_(result: Result, actionName: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      result.current.accessibilityProps.onAccessibilityAction?.({
        nativeEvent: { actionName },
      } as AccessibilityActionEvent);
    });
  }
}

beforeEach(() => jest.clearAllMocks());

describe('stepping a chart from a screen reader or keyboard', () => {
  it('declares one adjustable element with the step and page actions', async () => {
    const { result } = await renderChart({ data: days(10) });
    const props = result.current.accessibilityProps;

    expect(props.accessible).toBe(true);
    expect(props.accessibilityRole).toBe('adjustable');
    expect(props.accessibilityActions?.map((a) => a.name)).toEqual(
      expect.arrayContaining(['increment', 'decrement', 'pageForward', 'pageBack'])
    );
    for (const action of props.accessibilityActions ?? []) {
      if (action.name.startsWith('page')) expect(action.label).toBeTruthy();
    }
  });

  it('steps forward by one sample from the selected index and clamps at the last', async () => {
    const onSelect = jest.fn();
    const { result } = await renderChart({ data: days(8), onSelect });

    await act_(result, 'increment');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ day: 'day 1' }), 0);
    onSelect.mockClear();

    await act_(result, 'increment', 5);
    expect(onSelect).toHaveBeenCalledTimes(5);
    expect(onSelect.mock.calls.map(([, i]) => i)).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.selectedPoint).toEqual({ x: 5, day: 'day 6' });
    expect(result.current.accessibilityProps.accessibilityValue).toEqual({ text: 'day 6' });

    onSelect.mockClear();
    await act_(result, 'increment', 5);
    expect(onSelect.mock.calls.map(([, i]) => i)).toEqual([6, 7]);
    expect(result.current.selectedPoint).toEqual({ x: 7, day: 'day 8' });
  });

  it('steps back by one sample and clamps at the first', async () => {
    const onSelect = jest.fn();
    const { result } = await renderChart({ data: days(5), onSelect });

    await act_(result, 'increment', 3);
    onSelect.mockClear();
    await act_(result, 'decrement', 4);

    expect(onSelect.mock.calls.map(([, i]) => i)).toEqual([1, 0]);
    expect(result.current.accessibilityProps.accessibilityValue).toEqual({ text: 'day 1' });
  });

  it('starts from the newest sample when stepping back from nothing selected', async () => {
    const onSelect = jest.fn();
    const { result } = await renderChart({ data: days(5), onSelect });

    await act_(result, 'decrement');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ day: 'day 5' }), 4);
  });

  it('pages by a tenth of a long series and clamps at both ends', async () => {
    const onSelect = jest.fn();
    const { result } = await renderChart({ data: days(365), onSelect });

    await act_(result, 'increment');
    await act_(result, 'pageForward', 2);
    expect(onSelect.mock.calls.map(([, i]) => i)).toEqual([0, 37, 74]);

    await act_(result, 'pageForward', 20);
    expect(result.current.selectedPoint?.x).toBe(364);

    await act_(result, 'pageBack', 20);
    expect(result.current.selectedPoint?.x).toBe(0);
  });

  it('pages by one sample on a series shorter than ten', async () => {
    const onSelect = jest.fn();
    const { result } = await renderChart({ data: days(4), onSelect });

    await act_(result, 'increment');
    await act_(result, 'pageForward');

    expect(onSelect.mock.calls.map(([, i]) => i)).toEqual([0, 1]);
  });

  it('continues from a day pinned from outside the chart', async () => {
    const onSelect = jest.fn();
    const pinnedDay = { value: 6 };
    const { result } = await renderChart({
      data: days(10),
      onSelect,
      externalSelectedIdx: pinnedDay as never,
    });

    await act_(result, 'increment');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ day: 'day 8' }), 7);
  });

  it('continues from where a sibling chart moved the selection since its own step', async () => {
    const onSelect = jest.fn();
    const shared = { value: -1 };
    const { result } = await renderChart({
      data: days(10),
      onSelect,
      sharedSelectedIdx: shared as never,
    });

    await act_(result, 'increment', 2);
    shared.value = 6;
    onSelect.mockClear();
    await act_(result, 'decrement');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ day: 'day 6' }), 5);
  });

  it('fires no haptic on any step', async () => {
    const { result } = await renderChart({ data: days(8) });

    await act_(result, 'increment', 5);
    await act_(result, 'decrement', 2);
    await act_(result, 'pageForward');

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('opens no scrub, so a scrolling screen stays scrollable', async () => {
    const onInteractionChange = jest.fn();
    const { result } = await renderChart({ data: days(8), onInteractionChange });

    await act_(result, 'increment', 3);

    expect(onInteractionChange).not.toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
  });

  it('writes the sibling charts’ shared index so their crosshairs follow', async () => {
    const shared = { value: -1 };
    const { result } = await renderChart({ data: days(8), sharedSelectedIdx: shared as never });

    await act_(result, 'increment', 3);

    expect(shared.value).toBe(2);
  });

  it('carries the position as a range on Android and only the reading on iOS', async () => {
    const originalOS = Platform.OS;
    try {
      Platform.OS = 'android';
      const android = await renderChart({ data: days(8) });
      expect(android.result.current.accessibilityProps.accessibilityValue).toBeUndefined();
      await act_(android.result, 'increment', 3);
      expect(android.result.current.accessibilityProps.accessibilityValue).toEqual({
        min: 0,
        max: 7,
        now: 2,
        text: 'day 3',
      });

      Platform.OS = 'ios';
      const ios = await renderChart({ data: days(8) });
      await act_(ios.result, 'increment', 3);
      expect(ios.result.current.accessibilityProps.accessibilityValue).toEqual({ text: 'day 3' });
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('speaks the stepped reading on Android, where the delegate sends no event for a value with text', async () => {
    const originalOS = Platform.OS;
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    try {
      Platform.OS = 'android';
      const android = await renderChart({ data: days(8) });
      await act_(android.result, 'increment', 2);
      await act_(android.result, 'decrement');
      expect(announce.mock.calls.map(([text]) => text)).toEqual(['day 1', 'day 2', 'day 1']);

      announce.mockClear();
      await act_(android.result, 'decrement', 3);
      // Already at the first sample, so the clamp changes nothing to speak.
      expect(announce).not.toHaveBeenCalled();

      Platform.OS = 'ios';
      const ios = await renderChart({ data: days(8) });
      announce.mockClear();
      await act_(ios.result, 'increment');
      expect(announce).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
      announce.mockRestore();
    }
  });

  it('declares nothing for an empty chart or one whose scrub is off', async () => {
    const empty = await renderChart({ data: [] });
    const compact = await renderChart({ data: days(5), scrubEnabled: false });

    expect(empty.result.current.accessibilityProps).toEqual({});
    expect(compact.result.current.accessibilityProps).toEqual({});
  });
});
