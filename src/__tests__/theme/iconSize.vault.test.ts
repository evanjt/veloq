/**
 * Scenario: icons were drawn at seventeen sizes, so one screen's glyph read
 * larger than its neighbour's.
 *
 * Expected behaviour: the icon token holds the guide's six sizes, and the rungs
 * the text rule pairs with a type role draw larger than that role's text.
 */

import { iconSize, typography } from '@/theme';

describe('the icon size token', () => {
  it('holds the six sizes of the ladder', () => {
    expect(iconSize).toEqual({ xs: 12, sm: 16, md: 20, lg: 24, xl: 32, xxl: 48 });
  });

  it('draws the text-paired rungs larger than the text they sit beside', () => {
    expect(iconSize.sm).toBeGreaterThan(typography.caption.fontSize);
    expect(iconSize.sm).toBeGreaterThan(typography.bodyCompact.fontSize);
    expect(iconSize.md).toBeGreaterThan(typography.bodySmall.fontSize);
    expect(iconSize.md).toBeGreaterThan(typography.body.fontSize);
  });
});
