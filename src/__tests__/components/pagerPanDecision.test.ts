/**
 * Scenario: the tab pager activated on 10 pt of horizontal motion anywhere, so
 * on a pushed screen it took every rightward swipe, including one from the
 * leading edge and one at the first tab where it has nowhere to go, and the
 * system back swipe never fired.
 *
 * Expected behaviour: the pager fails, leaving the swipe to the system, when the
 * touch starts in the leading-edge strip or when it moves toward a page that does
 * not exist; it activates past the threshold otherwise, and waits below it.
 */

import { BACK_SWIPE_EDGE_WIDTH, startsInBackSwipeEdge } from '@/shared/ui/backSwipeEdge';
import { pagerPanDecision } from '@/shared/ui/pagerPanDecision';

const SCREEN = 400;
const MID = 200;

function decide(index: number, startX: number, translationX: number, isRTL = false) {
  return pagerPanDecision({
    index,
    tabCount: 3,
    startX,
    translationX,
    screenWidth: SCREEN,
    isRTL,
    edgeWidth: BACK_SWIPE_EDGE_WIDTH,
  });
}

describe('pagerPanDecision', () => {
  it('fails a rightward pan at the first tab, so back can take it', () => {
    expect(decide(0, MID, 15)).toBe('fail');
  });

  it('activates a leftward pan at the first tab', () => {
    expect(decide(0, MID, -15)).toBe('activate');
  });

  it('fails a pan that starts in the leading edge, at the first tab and past it', () => {
    expect(decide(0, 8, 15)).toBe('fail');
    expect(decide(1, 8, 15)).toBe('fail');
    expect(decide(1, 8, -15)).toBe('fail');
  });

  it('fails an edge start before the pan has moved far enough to decide', () => {
    expect(decide(1, 8, 2)).toBe('fail');
  });

  it('activates a rightward pan from mid-screen past the first tab', () => {
    expect(decide(1, MID, 15)).toBe('activate');
  });

  it('fails a leftward pan at the last tab', () => {
    expect(decide(2, MID, -15)).toBe('fail');
  });

  it('activates a rightward pan at the last tab', () => {
    expect(decide(2, MID, 15)).toBe('activate');
  });

  it('waits below the threshold, in either direction', () => {
    expect(decide(1, MID, 6)).toBe('wait');
    expect(decide(1, MID, -6)).toBe('wait');
    expect(decide(0, MID, 6)).toBe('wait');
    expect(decide(1, MID, 10)).toBe('wait');
  });

  it('treats the edge strip as exclusive at its inner boundary', () => {
    expect(decide(1, BACK_SWIPE_EDGE_WIDTH - 0.5, 15)).toBe('fail');
    expect(decide(1, BACK_SWIPE_EDGE_WIDTH, 15)).toBe('activate');
  });

  it('fails a single tab in both directions, since it has no page to move to', () => {
    const one = (translationX: number) =>
      pagerPanDecision({
        index: 0,
        tabCount: 1,
        startX: MID,
        translationX,
        screenWidth: SCREEN,
        isRTL: false,
        edgeWidth: BACK_SWIPE_EDGE_WIDTH,
      });
    expect(one(15)).toBe('fail');
    expect(one(-15)).toBe('fail');
  });

  it('moves the edge to the right under a right-to-left layout', () => {
    expect(decide(1, 8, 15, true)).toBe('activate');
    expect(decide(1, SCREEN - 8, -15, true)).toBe('fail');
    expect(decide(0, SCREEN - 8, -15, true)).toBe('fail');
  });
});

describe('startsInBackSwipeEdge', () => {
  it('reads the left strip in a left-to-right layout', () => {
    expect(startsInBackSwipeEdge(0, SCREEN, false)).toBe(true);
    expect(startsInBackSwipeEdge(BACK_SWIPE_EDGE_WIDTH - 1, SCREEN, false)).toBe(true);
    expect(startsInBackSwipeEdge(BACK_SWIPE_EDGE_WIDTH, SCREEN, false)).toBe(false);
    expect(startsInBackSwipeEdge(SCREEN - 1, SCREEN, false)).toBe(false);
  });

  it('reads the right strip in a right-to-left layout', () => {
    expect(startsInBackSwipeEdge(SCREEN - 1, SCREEN, true)).toBe(true);
    expect(startsInBackSwipeEdge(SCREEN - BACK_SWIPE_EDGE_WIDTH, SCREEN, true)).toBe(false);
    expect(startsInBackSwipeEdge(0, SCREEN, true)).toBe(false);
  });
});
