/**
 * Manual activity entries arrive as free-form route-param strings. A non-numeric
 * or NaN value must never persist as NaN: duration/distance coerce to a finite
 * number or 0, and avgHr stays null unless it parses to a finite number. Imports
 * the helper by deep path so no feature barrel (native modules) loads.
 */

import { parseManualSummary } from '@/features/recording/lib/parseManualSummary';

describe('parseManualSummary', () => {
  it('parses valid numeric strings', () => {
    const r = parseManualSummary({ durationSeconds: '3600', distance: '10000', avgHr: '150' });
    expect(r.duration).toBe(3600);
    expect(r.distance).toBe(10000);
    expect(r.avgHeartrate).toBe(150);
    expect(r.avgSpeed).toBeCloseTo(10000 / 3600, 6);
  });

  it('coerces non-numeric duration/distance to 0, never NaN', () => {
    const r = parseManualSummary({ durationSeconds: 'abc', distance: 'xyz', avgHr: '120' });
    expect(r.duration).toBe(0);
    expect(r.distance).toBe(0);
    expect(Number.isNaN(r.duration)).toBe(false);
    expect(Number.isNaN(r.distance)).toBe(false);
  });

  it('coerces explicit NaN-yielding values to finite 0', () => {
    const r = parseManualSummary({
      durationSeconds: 'NaN',
      distance: undefined,
      avgHr: undefined,
    });
    expect(r.duration).toBe(0);
    expect(r.distance).toBe(0);
    expect(r.avgHeartrate).toBeNull();
  });

  it('keeps avgHeartrate null for non-numeric or absent HR', () => {
    expect(parseManualSummary({ avgHr: 'not-a-number' }).avgHeartrate).toBeNull();
    expect(parseManualSummary({}).avgHeartrate).toBeNull();
  });

  it('never produces NaN avgSpeed when duration or distance is zero', () => {
    expect(parseManualSummary({ durationSeconds: '0', distance: '5000' }).avgSpeed).toBe(0);
    expect(parseManualSummary({ durationSeconds: '3600', distance: '0' }).avgSpeed).toBe(0);
    expect(parseManualSummary({ durationSeconds: 'bad', distance: 'bad' }).avgSpeed).toBe(0);
  });

  it('parses a zero-padded or whitespace HR string', () => {
    expect(parseManualSummary({ avgHr: ' 145 ' }).avgHeartrate).toBe(145);
    expect(parseManualSummary({ avgHr: '0' }).avgHeartrate).toBe(0);
  });
});
