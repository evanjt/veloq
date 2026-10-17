/**
 * Scenario: the activity chart re-rendered its root on every scrub index, which
 * rebuilt the accessor object `ChartCanvas` keys its frame memo on and so
 * re-ran d3 `curveNatural` and `Skia.Path.MakeFromSVGString` three times per
 * series, inside the gesture.
 *
 * Expected behaviour: the accessors are stable while the series are, and the
 * scrub value reaches the one component that draws it without the chart root
 * rendering at all.
 */

import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';

import {
  useSeriesAccessors,
  type SeriesAccessors,
} from '@/features/activity/components/useSeriesAccessors';
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
  it('keeps the series accessors stable while the series are', async () => {
    const series = [{ id: 'watts' }, { id: 'heartrate' }];
    const { result, rerender } = await renderHook<SeriesAccessors, { s: { id: string }[] }>(
      ({ s }) => useSeriesAccessors(s),
      { initialProps: { s: series } }
    );
    const first = result.current;

    await rerender({ s: series });

    expect(result.current).toBe(first);
    expect(first.watts({ watts: 210 })).toBe(210);
  });

  it('builds new accessors when the series themselves change', async () => {
    const { result, rerender } = await renderHook<SeriesAccessors, { s: { id: string }[] }>(
      ({ s }) => useSeriesAccessors(s),
      { initialProps: { s: [{ id: 'watts' }] } }
    );
    const first = result.current;

    await rerender({ s: [{ id: 'watts' }, { id: 'cadence' }] });

    expect(result.current).not.toBe(first);
    expect(Object.keys(result.current)).toEqual(['watts', 'cadence']);
  });

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

  it('puts the hint back when the gesture ends', async () => {
    const { ref, tree } = await harness();

    await act(() => ref.current!.setScrub(12.5));
    await act(() => ref.current!.setScrub(null));

    expect(tree.queryByTestId('chart-x-axis-scrub')).toBeNull();
    expect(tree.getByText('activity.chartHint')).toBeTruthy();
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
