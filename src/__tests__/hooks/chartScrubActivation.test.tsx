/**
 * Scenario: a chart scrub waited for a still hold before it moved, where a
 * scrubber should start on the first move.
 *
 * Expected behaviour: a horizontal move past the slop starts the scrub with no
 * wait and selects the point under the finger, before the tab pager around the
 * chart claims the same move. A vertical move fails the scrub so the page
 * scrolls, and a touch in the back-swipe strip is left to the system.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { useChartGestures } from '@/shared/charts/useChartGestures';
import { SCRUB_SLOP } from '@/shared/charts/scrubPanDecision';
import { BACK_SWIPE_EDGE_WIDTH } from '@/shared/ui/backSwipeEdge';
import { pagerPanDecision } from '@/shared/ui/pagerPanDecision';
import { capturePans, dragPan, scrubPan, touchAndMove, touchAt } from '../__shared__/chartScrub';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
}));

const DAYS = Array.from({ length: 10 }, (_, i) => ({ x: i, day: `day ${i + 1}` }));
const travel = SCRUB_SLOP + 2;

async function renderChart() {
  const built = capturePans();
  const onSelect = jest.fn();
  const onInteractionChange = jest.fn();
  const { result } = await renderHook(() =>
    useChartGestures({ data: DAYS, accessibilityLabel: 'Kiln heat', onSelect, onInteractionChange })
  );
  await act(async () => {
    result.current.syncXCoords(DAYS, (d) => d.x * 10);
  });
  return { pan: scrubPan(built), onSelect, onInteractionChange };
}

function start(pan: ReturnType<typeof scrubPan>, x: number) {
  return act(async () => {
    (pan as unknown as { handlers: { onStart: (e: { x: number }) => void } }).handlers.onStart({
      x,
    });
  });
}

async function renderDragChart(haptics?: boolean) {
  const built = capturePans();
  await renderHook(() =>
    useChartGestures({
      data: DAYS,
      accessibilityLabel: 'Kiln heat',
      scrubActivation: 'drag',
      haptics,
    })
  );
  return dragPan(built);
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('chart scrub activation', () => {
  it('starts on the first horizontal move, with no hold, and selects the point under the finger', async () => {
    const { pan, onSelect, onInteractionChange } = await renderChart();

    const mgr = await touchAndMove(pan, touchAt(30), [touchAt(30, travel)]);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();

    await start(pan, 30 + travel);
    expect(onSelect).toHaveBeenLastCalledWith(DAYS[4], 4);
    expect(onInteractionChange).toHaveBeenLastCalledWith(true);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('starts a leftward scrub the same way', async () => {
    const { pan } = await renderChart();

    const mgr = await touchAndMove(pan, touchAt(60), [touchAt(60, -travel)]);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
  });

  it('waits while the finger is still inside the slop', async () => {
    const { pan, onSelect } = await renderChart();

    const mgr = await touchAndMove(pan, touchAt(30), [touchAt(30, SCRUB_SLOP, SCRUB_SLOP)]);
    expect(mgr.activate).not.toHaveBeenCalled();
    expect(mgr.fail).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('fails on a vertical move so the page scrolls, and selects nothing', async () => {
    const { pan, onSelect, onInteractionChange } = await renderChart();

    const mgr = await touchAndMove(pan, touchAt(30), [touchAt(30, 3, travel)]);
    expect(mgr.fail).toHaveBeenCalledTimes(1);
    expect(mgr.activate).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onInteractionChange).not.toHaveBeenCalled();
  });

  it('fails on a diagonal move that is more vertical than horizontal', async () => {
    const { pan } = await renderChart();

    const mgr = await touchAndMove(pan, touchAt(30), [touchAt(30, travel, travel + 1)]);
    expect(mgr.fail).toHaveBeenCalledTimes(1);
    expect(mgr.activate).not.toHaveBeenCalled();
  });

  it('decides once, so a later move neither activates again nor fails the scrub', async () => {
    const { pan } = await renderChart();

    const mgr = await touchAndMove(pan, touchAt(30), [
      touchAt(30, travel),
      touchAt(30, travel, 80),
      touchAt(30, travel + 20),
    ]);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();
  });

  it('leaves a touch in the back-swipe strip to the system', async () => {
    const { pan } = await renderChart();
    const edge = (dx: number) => ({
      allTouches: [{ absoluteX: BACK_SWIPE_EDGE_WIDTH - 1 + dx, absoluteY: 100, x: 5 + dx }],
    });

    const mgr = await touchAndMove(pan, edge(0), [edge(travel)]);
    expect(mgr.fail).toHaveBeenCalledTimes(1);
    expect(mgr.activate).not.toHaveBeenCalled();
  });

  it('claims the move before the tab pager around the chart does', () => {
    const pager = { index: 1, tabCount: 3, startX: 200, screenWidth: 400, isRTL: false };
    expect(pagerPanDecision({ ...pager, translationX: SCRUB_SLOP + 1 })).toBe('wait');
    expect(pagerPanDecision({ ...pager, translationX: -(SCRUB_SLOP + 1) })).toBe('wait');
  });
});

describe('drag-activated chart scrub haptic', () => {
  it('fires one light impact when a drag scrub activates', async () => {
    const pan = await renderDragChart();

    await start(pan, 30);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('fires no further impact for later moves in the same drag', async () => {
    const pan = await renderDragChart();

    await start(pan, 30);
    await act(async () => {
      const { handlers } = pan as unknown as { handlers: { onUpdate: (e: { x: number }) => void } };
      handlers.onUpdate({ x: 40 });
      handlers.onUpdate({ x: 50 });
    });
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('fires no impact for a press that never travels past the slop', async () => {
    const pan = await renderDragChart();

    await act(async () => {
      (pan as unknown as { handlers: { onFinalize: () => void } }).handlers.onFinalize();
    });
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('fires no impact when haptics are off', async () => {
    const pan = await renderDragChart(false);

    await start(pan, 30);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
