/**
 * Scenario: the ahead or behind chart scrubs a distance along the section, and the map draws a
 * marker where that attempt was at that distance.
 *
 * Expected behaviour: the distance is placed along the trace by its share of the section length,
 * clamped to the trace's ends, and there is no marker without a trace or a length.
 */
import { scrubCoordinate } from '../scrubCoordinate';

// Three points a degree of latitude apart on one meridian, so the legs are equal.
const LAP = [
  { lat: 0, lng: 10 },
  { lat: 1, lng: 10 },
  { lat: 2, lng: 10 },
];

describe('scrubCoordinate', () => {
  it('sits on the first point at distance 0', () => {
    expect(scrubCoordinate(LAP, 0, 1000)).toEqual({ lat: 0, lng: 10 });
  });

  it('sits halfway along the trace at half the section length', () => {
    const point = scrubCoordinate(LAP, 500, 1000);
    expect(point?.lat).toBeCloseTo(1, 6);
    expect(point?.lng).toBeCloseTo(10, 6);
  });

  it('interpolates inside a leg', () => {
    const point = scrubCoordinate(LAP, 250, 1000);
    expect(point?.lat).toBeCloseTo(0.5, 3);
  });

  it('sits on the last point at the end', () => {
    expect(scrubCoordinate(LAP, 1000, 1000)).toEqual({ lat: 2, lng: 10 });
  });

  it('clamps a distance past the end to the last point and one before the start to the first', () => {
    expect(scrubCoordinate(LAP, 5000, 1000)).toEqual({ lat: 2, lng: 10 });
    expect(scrubCoordinate(LAP, -20, 1000)).toEqual({ lat: 0, lng: 10 });
  });

  it('places by share of the length when the trace is longer than the section', () => {
    const point = scrubCoordinate(LAP, 500, 500);
    expect(point).toEqual({ lat: 2, lng: 10 });
  });

  it('gives nothing without a trace, a length, or a finite distance', () => {
    expect(scrubCoordinate([], 10, 1000)).toBeNull();
    expect(scrubCoordinate(LAP, 10, 0)).toBeNull();
    expect(scrubCoordinate(LAP, Number.NaN, 1000)).toBeNull();
  });

  it('gives the only point of a one-point trace', () => {
    expect(scrubCoordinate([{ lat: 3, lng: 4 }], 10, 100)).toEqual({ lat: 3, lng: 4 });
  });

  it('gives the first point of a trace that does not move', () => {
    const still = [
      { lat: 3, lng: 4 },
      { lat: 3, lng: 4 },
    ];
    expect(scrubCoordinate(still, 50, 100)).toEqual({ lat: 3, lng: 4 });
  });
});
