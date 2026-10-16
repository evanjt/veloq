import { controlHeight, spacing } from '@/theme';
import {
  filterSheetExpandedAfterDrag,
  filterSheetMaxHeight,
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
