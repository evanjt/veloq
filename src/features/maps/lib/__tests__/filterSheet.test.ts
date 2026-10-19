import { controlHeight, spacing } from '@/theme';
import {
  filterSheetDragHeight,
  filterSheetExpandedAfterDrag,
  filterSheetMaxHeight,
  filterSheetSettleHeight,
  filterSheetStops,
  mapTopControlsBottom,
  popupBottom,
} from '../filterSheet';

describe('filterSheetExpandedAfterDrag', () => {
  it('opens on a drag up past the distance threshold and closes on one down', () => {
    expect(filterSheetExpandedAfterDrag(false, -40, 0)).toBe(true);
    expect(filterSheetExpandedAfterDrag(true, 40, 0)).toBe(false);
  });

  it('opens or closes on a short fast flick', () => {
    expect(filterSheetExpandedAfterDrag(false, -8, -900)).toBe(true);
    expect(filterSheetExpandedAfterDrag(true, 8, 900)).toBe(false);
  });

  it('stays where it was on a short slow drag', () => {
    expect(filterSheetExpandedAfterDrag(false, -8, -100)).toBe(false);
    expect(filterSheetExpandedAfterDrag(true, 8, 100)).toBe(true);
  });

  it('holds at the threshold itself', () => {
    expect(filterSheetExpandedAfterDrag(false, -24, 0)).toBe(false);
    expect(filterSheetExpandedAfterDrag(false, -25, 0)).toBe(true);
  });

  it('ignores a drag further in the direction it already sits', () => {
    expect(filterSheetExpandedAfterDrag(true, -200, -2000)).toBe(true);
    expect(filterSheetExpandedAfterDrag(false, 200, 2000)).toBe(false);
  });

  it('follows the fling when distance and velocity disagree', () => {
    expect(filterSheetExpandedAfterDrag(false, -40, 900)).toBe(false);
    expect(filterSheetExpandedAfterDrag(true, 40, -900)).toBe(true);
  });
});

describe('filterSheetDragHeight', () => {
  it('follows the finger between the two stops', () => {
    expect(filterSheetDragHeight(200, -80, 200, 500)).toBe(280);
    expect(filterSheetDragHeight(500, 120, 200, 500)).toBe(380);
  });

  it('stays at the start height until the finger moves', () => {
    expect(filterSheetDragHeight(200, 0, 200, 500)).toBe(200);
    expect(filterSheetDragHeight(500, 0, 200, 500)).toBe(500);
  });

  it('stops at the raised height on a drag up past it', () => {
    expect(filterSheetDragHeight(200, -400, 200, 500)).toBe(500);
  });

  it('stops at the lowered height on a drag down past it', () => {
    expect(filterSheetDragHeight(500, 400, 200, 500)).toBe(200);
    expect(filterSheetDragHeight(200, 60, 200, 500)).toBe(200);
  });
});

describe('filterSheetSettleHeight', () => {
  it('rises on a slow drag up past the threshold', () => {
    expect(filterSheetSettleHeight(false, -40, -100, 200, 500)).toBe(500);
  });

  it('lowers on a fast flick down from raised, however short', () => {
    expect(filterSheetSettleHeight(true, 8, 900, 200, 500)).toBe(200);
  });

  it('returns to the stop it started on after a short slow drag', () => {
    expect(filterSheetSettleHeight(false, -8, -100, 200, 500)).toBe(200);
    expect(filterSheetSettleHeight(true, 8, 100, 200, 500)).toBe(500);
  });
});

describe('filterSheetStops', () => {
  it('raises by the height of the rows the lowered sheet hides', () => {
    expect(filterSheetStops(200, 300, 700)).toEqual({ lowered: 200, raised: 500 });
  });

  it('stops the raised sheet under the top controls, past which its filters scroll', () => {
    expect(filterSheetStops(200, 600, 700)).toEqual({ lowered: 200, raised: 700 });
  });

  it('bounds no stop before the screen is measured', () => {
    expect(filterSheetStops(200, 600, undefined)).toEqual({ lowered: 200, raised: 800 });
  });

  it('never sets the lowered stop past the bound on a screen too short for it', () => {
    expect(filterSheetStops(200, 300, 150)).toEqual({ lowered: 150, raised: 150 });
  });
});

describe('popupBottom', () => {
  it('sets a popup above the lowered sheet and its credit', () => {
    expect(popupBottom(160, 34)).toBeGreaterThan(160);
  });

  it('follows the raised sheet past where a fixed offset would sit', () => {
    expect(popupBottom(420, 34)).toBeGreaterThan(420);
    expect(popupBottom(640, 34)).toBeGreaterThan(640);
  });

  it('keeps clear of the home indicator before the sheet is measured', () => {
    expect(popupBottom(0, 34)).toBeGreaterThan(34);
    expect(popupBottom(0, 0)).toBeGreaterThan(0);
  });

  it('leaves the same gap above the sheet whatever its height', () => {
    expect(popupBottom(420, 34) - 420).toBe(popupBottom(160, 34) - 160);
  });
});

describe('filterSheetMaxHeight', () => {
  it('bounds the sheet by the space under the top controls', () => {
    expect(filterSheetMaxHeight(844, 47)).toBe(844 - mapTopControlsBottom(47));
    expect(mapTopControlsBottom(47)).toBe(47 + spacing.smPlus + controlHeight.button + spacing.sm);
  });

  it('sets no bound before the screen is measured', () => {
    expect(filterSheetMaxHeight(0, 47)).toBeUndefined();
  });

  it('never bounds the sheet below nothing on a screen shorter than the controls', () => {
    expect(filterSheetMaxHeight(60, 47)).toBe(0);
  });
});
