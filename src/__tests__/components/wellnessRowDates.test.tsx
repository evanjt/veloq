/**
 * Scenario: each wellness row carries only the days its metric was logged,
 * while the header names the scrubbed day or, at rest, one date for every row.
 *
 * Expected behaviour: a scrubbed day a metric has no reading on shows '-' for
 * it, and at rest no row's last reading is presented as a later day's.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { formatShortDate, formatShortDateWithWeekday } from '@/shared/format/format';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// HRV is logged on 1 and 20 June only, resting HR every day through the 30th.
const DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  hrv: i === 0 ? 61 : i === 19 ? 87 : undefined,
  restingHR: 50,
}));

type PanGesture = ReturnType<typeof Gesture.Pan>;
type PanHandlers = { onStart: (e: { x: number }) => void };

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

function layout(tree: ReturnType<typeof render>) {
  const container = tree.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  act(() => {
    fireEvent(container!, 'layout', { nativeEvent: { layout: { width: 360, height: 300 } } });
  });
}

async function scrubTo(gesture: PanGesture, x: number) {
  await act(async () => {
    (gesture as unknown as { handlers: PanHandlers }).handlers.onStart({ x });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('wellness row dates', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows no HRV on a scrubbed day HRV was not logged', async () => {
    const built = captureGestures();
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="7d" />);
    layout(tree);

    await scrubTo(built[built.length - 1], 1000);

    expect(tree.getByText(formatShortDateWithWeekday('2026-06-30'))).toBeTruthy();
    expect(tree.queryByText('87')).toBeNull();
    expect(tree.getByText('-')).toBeTruthy();
    expect(tree.getByText('50')).toBeTruthy();
  });

  it('shows a logged reading on the day it was logged', async () => {
    const built = captureGestures();
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="7d" />);
    layout(tree);

    await scrubTo(built[built.length - 1], 0);

    expect(tree.getByText(formatShortDateWithWeekday('2026-06-01'))).toBeTruthy();
    expect(tree.getByText('61')).toBeTruthy();
  });

  it('at rest, names the newest day and dates a row whose reading is older', () => {
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="7d" />);
    layout(tree);

    expect(tree.queryByText('time.today')).toBeNull();
    expect(tree.getByText(formatShortDateWithWeekday('2026-06-30'))).toBeTruthy();
    expect(tree.getByText('87')).toBeTruthy();
    expect(tree.getByText(formatShortDate('2026-06-20'))).toBeTruthy();
    expect(tree.queryByText(formatShortDate('2026-06-30'))).toBeNull();
  });
});
