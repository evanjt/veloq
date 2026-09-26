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
  ChartDistanceIndicator,
  type ChartDistanceIndicatorHandle,
} from '@/features/activity/components/ChartDistanceIndicator';

/** A root that counts its own renders and hands the pill a stable ref. */
function harness(maxX = 42.2) {
  const renders = jest.fn();
  const ref = React.createRef<ChartDistanceIndicatorHandle>();

  function Root() {
    renders();
    return (
      <ChartDistanceIndicator
        ref={ref}
        xAxisMode="distance"
        maxX={maxX}
        xUnit="km"
        isDark={false}
        canToggleXAxis={false}
      />
    );
  }

  return { renders, ref, tree: render(<Root />) };
}

describe('chart scrub re-renders', () => {
  it('keeps the series accessors stable while the series are', () => {
    const series = [{ id: 'watts' }, { id: 'heartrate' }];
    const { result, rerender } = renderHook<SeriesAccessors, { s: { id: string }[] }>(
      ({ s }) => useSeriesAccessors(s),
      { initialProps: { s: series } }
    );
    const first = result.current;

    rerender({ s: series });

    expect(result.current).toBe(first);
    expect(first.watts({ watts: 210 })).toBe(210);
  });

  it('builds new accessors when the series themselves change', () => {
    const { result, rerender } = renderHook<SeriesAccessors, { s: { id: string }[] }>(
      ({ s }) => useSeriesAccessors(s),
      { initialProps: { s: [{ id: 'watts' }] } }
    );
    const first = result.current;

    rerender({ s: [{ id: 'watts' }, { id: 'cadence' }] });

    expect(result.current).not.toBe(first);
    expect(Object.keys(result.current)).toEqual(['watts', 'cadence']);
  });

  /**
   * The whole point of the handle: the pill owns the scrub value, so a scrub
   * tick never reaches the chart root. A render count that moves here is the
   * rebuild of every Skia path coming back.
   */
  it('moves the scrub value without rendering the chart root', () => {
    const { renders, ref, tree } = harness();
    const before = renders.mock.calls.length;
    expect(tree.getByText('42.2 km')).toBeTruthy();

    act(() => ref.current!.setScrub(12.5));

    expect(tree.getByText('12.50 km')).toBeTruthy();
    expect(renders.mock.calls.length).toBe(before);
  });

  it('goes back to the total when the gesture ends', () => {
    const { ref, tree } = harness();

    act(() => ref.current!.setScrub(12.5));
    act(() => ref.current!.setScrub(null));

    expect(tree.getByText('42.2 km')).toBeTruthy();
  });

  /**
   * Zero is a position, not an absent one. Treating a falsy scrub as the end of
   * the gesture puts the total back on screen at the start of the ride.
   */
  it('treats the start of the ride as a position, not as no scrub', () => {
    const { ref, tree } = harness();

    act(() => ref.current!.setScrub(0));

    expect(tree.getByText('0.00 km')).toBeTruthy();
  });
});
