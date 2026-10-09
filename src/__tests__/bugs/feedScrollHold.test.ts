/**
 * Scenario: an athlete drags the feed and lets it fling. The preview pool is
 * held for the whole movement, so no map render starts under the scroll.
 *
 * Expected behaviour: a drag holds, a fling keeps holding until it settles, and
 * a drag let go with no fling releases once nothing follows it. Every hold the
 * feed takes is released, including the one in flight when the feed goes away.
 */

import { SCROLL_SETTLE_MS, createScrollHold } from '@/features/activity/lib/feedScrollHold';

describe('the feed holds the preview pool while it moves', () => {
  let calls: boolean[];
  let handlers: ReturnType<typeof createScrollHold>;
  let disconnect: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    calls = [];
    handlers = createScrollHold();
    disconnect = handlers.connect((held) => calls.push(held));
  });

  afterEach(() => {
    disconnect();
    jest.useRealTimers();
  });

  it('holds when a drag begins', () => {
    handlers.onScrollBeginDrag();

    expect(calls).toEqual([true]);
  });

  it('keeps holding through a fling and releases when it settles', () => {
    handlers.onScrollBeginDrag();
    handlers.onScrollEndDrag();
    handlers.onMomentumScrollBegin();
    jest.advanceTimersByTime(SCROLL_SETTLE_MS * 10);

    expect(calls).toEqual([true, true]);

    handlers.onMomentumScrollEnd();

    expect(calls).toEqual([true, true, false]);
  });

  it('releases a drag let go with no fling once the settle has passed', () => {
    handlers.onScrollBeginDrag();
    handlers.onScrollEndDrag();
    jest.advanceTimersByTime(SCROLL_SETTLE_MS - 1);

    expect(calls).toEqual([true]);

    jest.advanceTimersByTime(1);

    expect(calls).toEqual([true, false]);
  });

  it('a second drag inside the settle keeps the hold', () => {
    handlers.onScrollBeginDrag();
    handlers.onScrollEndDrag();
    handlers.onScrollBeginDrag();
    jest.advanceTimersByTime(SCROLL_SETTLE_MS * 2);

    expect(calls).toEqual([true, true]);
  });

  it('releases the hold it holds when the feed goes away', () => {
    handlers.onScrollBeginDrag();
    disconnect();
    jest.advanceTimersByTime(SCROLL_SETTLE_MS * 2);

    expect(calls).toEqual([true, false]);
  });

  it('releases nothing on disconnect when it holds nothing', () => {
    disconnect();

    expect(calls).toEqual([]);
  });

  it('calls nothing once disconnected', () => {
    disconnect();
    handlers.onScrollBeginDrag();
    handlers.onMomentumScrollEnd();

    expect(calls).toEqual([]);
  });

  it('releases once when a pending settle and the disconnect meet', () => {
    handlers.onScrollBeginDrag();
    handlers.onScrollEndDrag();
    disconnect();
    jest.advanceTimersByTime(SCROLL_SETTLE_MS * 2);

    expect(calls).toEqual([true, false]);
  });
});
