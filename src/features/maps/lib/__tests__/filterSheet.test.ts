import { filterSheetExpandedAfterDrag } from '../filterSheet';

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
