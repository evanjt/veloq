/**
 * Scenario: on a release build the fitness screen offered "eFTP Trend 250w"
 * and "Swim Pace Curve 0:29/100m", and both charts under them said there was
 * no data. The row summary and the chart body read different sources, and only
 * the body knows whether there is a series to draw, so the athlete is told a
 * number, taps to see it, and is told the number does not exist.
 *
 * Expected behaviour: one rule, applied by both. A row states a value only
 * when its chart can plot one.
 */

import { curveHeaderValue } from '@/features/fitness/lib/curveHeaderValue';

describe('curveHeaderValue', () => {
  it('states the value when there is a curve to draw', () => {
    expect(curveHeaderValue({ value: 250, hasSeries: true })).toBe(250);
  });

  it('says nothing when the chart has no series, whatever the value', () => {
    expect(curveHeaderValue({ value: 250, hasSeries: false })).toBeNull();
    expect(curveHeaderValue({ value: 0.29, hasSeries: false })).toBeNull();
  });

  it('says nothing while the series is still loading, rather than a figure that may vanish', () => {
    expect(curveHeaderValue({ value: 250, hasSeries: false, isLoading: true })).toBeNull();
  });

  it('says nothing when there is no value, even with a series', () => {
    expect(curveHeaderValue({ value: null, hasSeries: true })).toBeNull();
    expect(curveHeaderValue({ value: undefined, hasSeries: true })).toBeNull();
  });

  it('treats zero as a value, since a zero pace is a real reading to withhold', () => {
    expect(curveHeaderValue({ value: 0, hasSeries: true })).toBe(0);
  });

  it('says nothing when the series read failed', () => {
    expect(curveHeaderValue({ value: 250, hasSeries: false, isError: true })).toBeNull();
  });
});
