/**
 * Scenario: the activity chart re-rendered its root on every scrub index, which
 * rebuilt every Skia path in every lane inside the gesture.
 *
 * Expected behaviour: the scrub value reaches the one component that draws it
 * without the chart root rendering at all.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';

import {
  ChartXAxisLabel,
  type ChartXAxisLabelHandle,
} from '@/features/activity/components/ChartXAxisLabel';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

/** A root that counts its own renders and hands the axis label a stable ref. */
async function harness(maxX = 42.2) {
  const renders = jest.fn();
  const ref = React.createRef<ChartXAxisLabelHandle>();

  function Root() {
    renders();
    return <ChartXAxisLabel ref={ref} xAxisMode="distance" maxX={maxX} xUnit="km" isDark={false} />;
  }

  return { renders, ref, tree: await render(<Root />) };
}

describe('chart scrub re-renders', () => {
  /**
   * The whole point of the handle: the axis label owns the scrub value, so a scrub
   * tick never reaches the chart root. A render count that moves here is the
   * rebuild of every Skia path coming back.
   */
  it('moves the scrub value without rendering the chart root', async () => {
    const { renders, ref, tree } = await harness();
    const before = renders.mock.calls.length;
    expect(tree.getByText('42.2 km')).toBeTruthy();
    expect(tree.queryByTestId('chart-x-axis-scrub')).toBeNull();

    await act(() => ref.current!.setScrub(12.5));

    expect(tree.getByTestId('chart-x-axis-scrub')).toHaveTextContent('12.50 km');
    expect(tree.getByText('42.2 km')).toBeTruthy();
    expect(renders.mock.calls.length).toBe(before);
  });

  it('clears the scrub position when the gesture ends', async () => {
    const { ref, tree } = await harness();

    await act(() => ref.current!.setScrub(12.5));
    await act(() => ref.current!.setScrub(null));

    expect(tree.queryByTestId('chart-x-axis-scrub')).toBeNull();
    expect(tree.getByText('42.2 km')).toBeTruthy();
  });

  /**
   * Zero is a position, not an absent one. Treating a falsy scrub as the end of
   * the gesture drops the position at the start of the ride.
   */
  it('treats the start of the ride as a position, not as no scrub', async () => {
    const { ref, tree } = await harness();

    await act(() => ref.current!.setScrub(0));

    expect(tree.getByTestId('chart-x-axis-scrub')).toHaveTextContent('0.00 km');
  });
});
