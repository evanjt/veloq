/**
 * Scenario: a summary card metric links to `/fitness?chart=ftp` or
 * `/training?chart=week`, and neither tab read the param, so the athlete
 * landed at the top of the tab with the chart collapsed or below the fold.
 *
 * Expected behaviour: the tab takes the chart once, prepares it (a section
 * expanded, a sport switched), scrolls to it as soon as it has a position,
 * follows it while the layout above it settles, stops when the athlete scrolls,
 * and clears the param so a later visit opens at the top.
 */

import { act, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';

import { useRevealChart } from '@/shared/app/useRevealChart';

type Chart = 'ftp' | 'week';
type Anchor = 'trends' | 'weekly';
const ANCHOR: Record<Chart, Anchor> = { ftp: 'trends', week: 'weekly' };

const layoutAt = (y: number) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 1, height: 1 } } }) as LayoutChangeEvent;

function setup(initial: Chart | null) {
  const scrollTo = jest.fn();
  const prepare = jest.fn();
  const hook = renderHook(
    ({ chart }: { chart: Chart | null }) => useRevealChart(chart, (c) => ANCHOR[c], prepare),
    { initialProps: { chart: initial } }
  );
  (hook.result.current.scrollRef as { current: unknown }).current = { scrollTo };
  return { ...hook, scrollTo, prepare };
}

beforeEach(() => jest.clearAllMocks());

describe('revealing a chart from the route', () => {
  it('does nothing without a chart', () => {
    const { result, scrollTo, prepare } = setup(null);

    act(() => result.current.onAnchorLayout('trends', layoutAt(400)));

    expect(prepare).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(router.setParams).not.toHaveBeenCalled();
  });

  it('prepares the chart and clears the param once', () => {
    const { prepare } = setup('ftp');

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith('ftp');
    expect(router.setParams).toHaveBeenCalledWith({ chart: undefined });
  });

  it('scrolls to the anchor when it lays out after the chart arrived', () => {
    const { result, scrollTo } = setup('week');

    act(() => result.current.onAnchorLayout('trends', layoutAt(200)));
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => result.current.onAnchorLayout('weekly', layoutAt(900)));
    expect(scrollTo).toHaveBeenCalledWith({ y: 900, animated: true });
  });

  it('scrolls at once to an anchor already laid out', () => {
    const { result, rerender, scrollTo } = setup(null);
    act(() => result.current.onAnchorLayout('trends', layoutAt(640)));

    rerender({ chart: 'ftp' });

    expect(scrollTo).toHaveBeenCalledWith({ y: 640, animated: true });
  });

  it('follows the anchor while the layout above it settles, until the athlete scrolls', () => {
    const { result, scrollTo } = setup('ftp');
    act(() => result.current.onAnchorLayout('trends', layoutAt(500)));
    act(() => result.current.onAnchorLayout('trends', layoutAt(720)));

    expect(scrollTo).toHaveBeenLastCalledWith({ y: 720, animated: true });

    act(() => result.current.onScrollBeginDrag());
    act(() => result.current.onAnchorLayout('trends', layoutAt(800)));

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('reveals again when a second link arrives on the mounted tab', () => {
    const { result, rerender, scrollTo, prepare } = setup('ftp');
    act(() => result.current.onAnchorLayout('trends', layoutAt(500)));
    act(() => result.current.onScrollBeginDrag());
    rerender({ chart: null });

    rerender({ chart: 'ftp' });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
