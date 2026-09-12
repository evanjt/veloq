/**
 * Scenario: the wellness trends chart recorded one Skia picture holding both
 * the five sparklines and the selection marks, keyed on the scrub index, so a
 * drag re-parsed five SVG path strings per tick. It also rebuilt its pan
 * gesture on every render.
 *
 * Expected behaviour: the sparklines are recorded once per data and layout
 * change, the selection is its own picture, and the gesture outlives the scrub.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';
import { Gesture } from 'react-native-gesture-handler';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  hrv: 40 + (i % 7),
  restingHR: 50 + (i % 5),
  sleepSecs: 25_200 + i * 60,
  sleepScore: 70 + (i % 10),
  weight: 72 + (i % 3) * 0.2,
}));

type PanGesture = ReturnType<typeof Gesture.Pan>;
type PanHandlers = {
  onStart: (e: { x: number }) => void;
  onUpdate: (e: { x: number }) => void;
  onEnd: () => void;
};

/** Every pan gesture the chart builds, newest last. */
function captureGestures() {
  const built: PanGesture[] = [];
  const real = Gesture.Pan.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = real();
    built.push(gesture);
    return gesture;
  });
  return built;
}

const handlersOf = (gesture: PanGesture) =>
  (gesture as unknown as { handlers: PanHandlers }).handlers;

/** The chart sizes itself from its container's onLayout, so give it a width. */
function layout(tree: ReturnType<typeof render>) {
  const container = tree.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  act(() => {
    fireEvent(container!, 'layout', { nativeEvent: { layout: { width: 360, height: 300 } } });
  });
}

/** The scrub reaches JS through runOnJS, which the reanimated mock defers. */
async function scrub(gesture: PanGesture, xs: number[]) {
  await act(async () => {
    handlersOf(gesture).onStart({ x: xs[0] });
    for (const x of xs.slice(1)) handlersOf(gesture).onUpdate({ x });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('wellness trends scrub', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records the sparklines once and re-records none of them on a scrub tick', async () => {
    const built = captureGestures();
    const svg = jest.spyOn(Skia.Path, 'MakeFromSVGString');
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    layout(tree);

    const atRest = svg.mock.calls.length;
    expect(atRest).toBe(5);

    await scrub(built[built.length - 1], [120, 160, 200]);

    expect(svg.mock.calls.length).toBe(atRest);
  });

  it('keeps one gesture across the scrub', async () => {
    const built = captureGestures();
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    layout(tree);

    const beforeScrub = built.length;
    await scrub(built[beforeScrub - 1], [120, 160, 200]);

    expect(built.length).toBe(beforeScrub);
  });

  it('reports the scrubbed date and clears it on release', async () => {
    const built = captureGestures();
    const onDateSelect = jest.fn();
    const tree = render(
      <WellnessTrendsChart data={DAYS} timeRange="1m" onDateSelect={onDateSelect} />
    );
    layout(tree);

    await scrub(built[built.length - 1], [300]);
    expect(onDateSelect).toHaveBeenCalledWith('2026-06-30');

    onDateSelect.mockClear();
    await act(async () => {
      handlersOf(built[built.length - 1]).onEnd();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onDateSelect).toHaveBeenCalledWith(null);
  });
});
