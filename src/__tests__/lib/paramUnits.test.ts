/**
 * Scenario: the parameter editors took and bounded a bare number of metres, so
 * an imperial athlete typed metres into a field captioned in feet or miles.
 *
 * Expected behaviour: a distance parameter is edited in the athlete's own
 * unit, and the value handed back to the detector is metres again.
 */

import {
  distanceEditorUnit,
  fromEditorValue,
  toEditorText,
} from '@/features/routes/lib/paramUnits';

describe('distanceEditorUnit', () => {
  it('edits short distances in metres and feet and the long ceiling in kilometres and miles', () => {
    expect(distanceEditorUnit(true, false)?.label).toBe('m');
    expect(distanceEditorUnit(false, false)?.label).toBe('ft');
    expect(distanceEditorUnit(true, true)?.label).toBe('km');
    expect(distanceEditorUnit(false, true)?.label).toBe('mi');
  });
});

describe('toEditorText', () => {
  it('shows metres unchanged for a metric athlete', () => {
    expect(toEditorText(200, distanceEditorUnit(true, false))).toBe('200');
  });

  it('shows feet for an imperial athlete', () => {
    expect(toEditorText(200, distanceEditorUnit(false, false))).toBe('656');
  });

  it('shows the long ceiling in kilometres and miles', () => {
    expect(toEditorText(200000, distanceEditorUnit(true, true))).toBe('200');
    expect(toEditorText(200000, distanceEditorUnit(false, true))).toBe('124.27');
  });

  it('shows a plain number when the parameter has no distance unit', () => {
    expect(toEditorText(0.15, null)).toBe('0.15');
  });
});

describe('fromEditorValue', () => {
  it('turns typed feet back into whole metres', () => {
    expect(fromEditorValue(656, distanceEditorUnit(false, false))).toBe(200);
  });

  it('turns typed miles back into metres', () => {
    expect(fromEditorValue(10, distanceEditorUnit(false, true))).toBe(16093);
  });

  it('turns typed kilometres back into metres', () => {
    expect(fromEditorValue(500, distanceEditorUnit(true, true))).toBe(500000);
  });

  it('leaves a value with no distance unit alone', () => {
    expect(fromEditorValue(0.8, null)).toBe(0.8);
  });
});
