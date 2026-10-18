/**
 * Scenario: a summary card metric links to `/fitness?chart=ftp` or
 * `/fitness?chart=week`, and the tab did not read the param, so the athlete
 * landed at the top of the tab with the chart collapsed or below the fold.
 *
 * Expected behaviour: the tab takes the chart once, prepares it (a section
 * expanded, a sport switched), scrolls to it as soon as it has a position,
 * follows it while the layout above it settles, stops when the athlete scrolls,
 * and clears the param so a later visit opens at the top. With reduce motion
 * on it jumps to the chart rather than scrolling. A page that pins a header
 * lands the chart below the header rather than under it.
 */

import { act, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';

import { useRevealChart } from '@/shared/app/useRevealChart';

let mockReduceMotion = false;
jest.mock('@/shared/ui/reduceMotion', () => ({
  ...jest.requireActual('@/shared/ui/reduceMotion'),
  isReduceMotionOn: () => mockReduceMotion,
}));

type Chart = 'ftp' | 'week';
type Anchor = 'trends' | 'weekly';
const ANCHOR: Record<Chart, Anchor> = { ftp: 'trends', week: 'weekly' };

const layoutAt = (y: number, height = 1) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 1, height } } }) as LayoutChangeEvent;

async function setup(initial: Chart | null) {
  const scrollTo = jest.fn();
  const prepare = jest.fn();
  const hook = await renderHook(
    ({ chart }: { chart: Chart | null }) => useRevealChart(chart, (c) => ANCHOR[c], prepare),
    { initialProps: { chart: initial } }
  );
  (hook.result.current.scrollRef as { current: unknown }).current = { scrollTo };
  return { ...hook, scrollTo, prepare };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReduceMotion = false;
});

describe('revealing a chart from the route', () => {
  it('does nothing without a chart', async () => {
    const { result, scrollTo, prepare } = await setup(null);

    await act(() => result.current.onAnchorLayout('trends', layoutAt(400)));

    expect(prepare).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(router.setParams).not.toHaveBeenCalled();
  });

  it('prepares the chart and clears the param once', async () => {
    const { prepare } = await setup('ftp');

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith('ftp');
    expect(router.setParams).toHaveBeenCalledWith({ chart: undefined });
  });

  it('scrolls to the anchor when it lays out after the chart arrived', async () => {
    const { result, scrollTo } = await setup('week');

    await act(() => result.current.onAnchorLayout('trends', layoutAt(200)));
    expect(scrollTo).not.toHaveBeenCalled();

    await act(() => result.current.onAnchorLayout('weekly', layoutAt(900)));
    expect(scrollTo).toHaveBeenCalledWith({ y: 900, animated: true });
  });

  it('scrolls at once to an anchor already laid out', async () => {
    const { result, rerender, scrollTo } = await setup(null);
    await act(() => result.current.onAnchorLayout('trends', layoutAt(640)));

    await rerender({ chart: 'ftp' });

    expect(scrollTo).toHaveBeenCalledWith({ y: 640, animated: true });
  });

  it('follows the anchor while the layout above it settles, until the athlete scrolls', async () => {
    const { result, scrollTo } = await setup('ftp');
    await act(() => result.current.onAnchorLayout('trends', layoutAt(500)));
    await act(() => result.current.onAnchorLayout('trends', layoutAt(720)));

    expect(scrollTo).toHaveBeenLastCalledWith({ y: 720, animated: true });

    await act(() => result.current.onScrollBeginDrag());
    await act(() => result.current.onAnchorLayout('trends', layoutAt(800)));

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('reveals again when a second link arrives on the mounted tab', async () => {
    const { result, rerender, scrollTo, prepare } = await setup('ftp');
    await act(() => result.current.onAnchorLayout('trends', layoutAt(500)));
    await act(() => result.current.onScrollBeginDrag());
    await rerender({ chart: null });

    await rerender({ chart: 'ftp' });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('jumps to the anchor without animating with reduce motion on', async () => {
    mockReduceMotion = true;
    const { result, scrollTo } = await setup('week');

    await act(() => result.current.onAnchorLayout('weekly', layoutAt(900)));

    expect(scrollTo).toHaveBeenCalledWith({ y: 900, animated: false });
  });
});

describe('revealing a chart below a pinned header', () => {
  it('lands the chart below the pinned height', async () => {
    const { result, scrollTo } = await setup('week');
    await act(() => result.current.onHeaderLayout(layoutAt(0, 42)));

    await act(() => result.current.onAnchorLayout('weekly', layoutAt(300)));

    expect(scrollTo).toHaveBeenCalledWith({ y: 258, animated: true });
  });

  it('never scrolls above the top for an anchor inside the pinned height', async () => {
    const { result, scrollTo } = await setup('week');
    await act(() => result.current.onHeaderLayout(layoutAt(0, 42)));

    await act(() => result.current.onAnchorLayout('weekly', layoutAt(20)));

    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('scrolls to the anchor itself when no header reported', async () => {
    const { result, scrollTo } = await setup('week');

    await act(() => result.current.onAnchorLayout('weekly', layoutAt(300)));

    expect(scrollTo).toHaveBeenCalledWith({ y: 300, animated: true });
  });

  it('follows the header when it lays out after the anchor', async () => {
    const { result, scrollTo } = await setup('week');
    await act(() => result.current.onAnchorLayout('weekly', layoutAt(300)));

    await act(() => result.current.onHeaderLayout(layoutAt(0, 42)));

    expect(scrollTo).toHaveBeenLastCalledWith({ y: 258, animated: true });
  });
});
