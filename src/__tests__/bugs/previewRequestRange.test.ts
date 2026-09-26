/**
 * Scenario: an athlete scrolls the feed. The list keeps two to three screens of
 * cards mounted either side of the viewport so scrolling does not blank, and
 * every mounted card used to ask for a map render on mount.
 *
 * Expected behaviour: mounting and asking are two different questions. A render
 * costs a WebView pass and a bridge crossing, so a card asks only once it is on
 * screen or one screen from it.
 */

import {
  withinPreviewRange,
  setVisibleRange,
  isWithinPreviewRange,
  onPreviewRangeChange,
} from '@/features/activity/lib/previewRange';

describe('which mounted cards may ask for a render', () => {
  it('lets every card through before the list has reported anything', () => {
    expect(withinPreviewRange(0, null)).toBe(true);
    expect(withinPreviewRange(40, null)).toBe(true);
  });

  it('lets a visible card through', () => {
    expect(withinPreviewRange(4, { first: 3, last: 5 })).toBe(true);
  });

  it('lets one screen of cards ahead through', () => {
    // Three visible, so a screen is three: 6, 7 and 8 are the lookahead.
    expect(withinPreviewRange(8, { first: 3, last: 5 })).toBe(true);
  });

  it('stops at the end of that screen', () => {
    expect(withinPreviewRange(9, { first: 3, last: 5 })).toBe(false);
    expect(withinPreviewRange(20, { first: 3, last: 5 })).toBe(false);
  });

  it('does not look behind, because a card above has been seen already', () => {
    expect(withinPreviewRange(2, { first: 3, last: 5 })).toBe(false);
  });

  it('treats a single visible card as a screen of one', () => {
    expect(withinPreviewRange(5, { first: 4, last: 4 })).toBe(true);
    expect(withinPreviewRange(6, { first: 4, last: 4 })).toBe(false);
  });
});

describe('the range the feed publishes', () => {
  beforeEach(() => {
    setVisibleRange(null);
  });

  it('answers for the live range', () => {
    setVisibleRange({ first: 10, last: 12 });

    expect(isWithinPreviewRange(12)).toBe(true);
    expect(isWithinPreviewRange(30)).toBe(false);
  });

  it('tells a listener when the range moves', () => {
    const heard: number[] = [];
    onPreviewRangeChange(() => heard.push(1));

    setVisibleRange({ first: 0, last: 2 });
    setVisibleRange({ first: 1, last: 3 });

    expect(heard).toHaveLength(2);
  });

  it('says nothing when the range has not moved', () => {
    setVisibleRange({ first: 0, last: 2 });
    const heard: number[] = [];
    onPreviewRangeChange(() => heard.push(1));

    setVisibleRange({ first: 0, last: 2 });

    expect(heard).toHaveLength(0);
  });

  it('stops telling a listener that has unsubscribed', () => {
    const heard: number[] = [];
    const stop = onPreviewRangeChange(() => heard.push(1));

    stop();
    setVisibleRange({ first: 5, last: 7 });

    expect(heard).toHaveLength(0);
  });
});
