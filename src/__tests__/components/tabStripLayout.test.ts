/**
 * Scenario: tabs sharing a strip with `flex: 1` give each an equal share, and a
 * label wider than its share was cut off with an ellipsis.
 *
 * Expected behaviour: when every tab fits its equal share the strip keeps equal
 * tabs; when any tab does not, every tab is sized to its content and the strip
 * scrolls, with offsets and widths for the indicator to follow.
 */

import { layoutTabStrip, scrollOffsetToShow } from '@/shared/ui/tabStripLayout';

describe('layoutTabStrip', () => {
  it('keeps equal tabs when every tab fits its share', () => {
    const layout = layoutTabStrip([80, 90, 70, 85], 400);

    expect(layout.scrolls).toBe(false);
    expect(layout.widths).toStrictEqual([100, 100, 100, 100]);
    expect(layout.offsets).toStrictEqual([0, 100, 200, 300]);
  });

  it('keeps equal tabs when a tab is exactly its share', () => {
    expect(layoutTabStrip([100, 100], 200).scrolls).toBe(false);
  });

  it('sizes every tab to its content when one is wider than its share', () => {
    const layout = layoutTabStrip([80, 130, 70, 85], 400);

    expect(layout.scrolls).toBe(true);
    expect(layout.widths).toStrictEqual([80, 130, 70, 85]);
    expect(layout.offsets).toStrictEqual([0, 80, 210, 280]);
    expect(layout.contentWidth).toBe(365);
  });

  it('keeps equal tabs before anything is measured', () => {
    const layout = layoutTabStrip([], 400);

    expect(layout.scrolls).toBe(false);
    expect(layout.widths).toStrictEqual([]);
  });

  it('keeps equal tabs while a tab is still unmeasured', () => {
    expect(layoutTabStrip([80, 0, 70], 300).scrolls).toBe(false);
  });
});

describe('scrollOffsetToShow', () => {
  const widths = [100, 100, 100, 100, 100, 100];
  const offsets = [0, 100, 200, 300, 400, 500];

  it('centres the active tab in the viewport', () => {
    expect(scrollOffsetToShow(offsets[3], widths[3], 300, 600)).toBe(200);
  });

  it('stays at the start for the first tab', () => {
    expect(scrollOffsetToShow(offsets[0], widths[0], 300, 600)).toBe(0);
  });

  it('stops at the end for the last tab', () => {
    expect(scrollOffsetToShow(offsets[5], widths[5], 300, 600)).toBe(300);
  });
});
