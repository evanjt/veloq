/**
 * Scenario: the marker follows the emphasised lap's own trace, and the section line when no lap
 * is emphasised.
 *
 * Expected behaviour: the lap wins, the line is the fallback, and nothing draws without a scrub.
 */
import { scrubMarkerCollection, scrubMarkerPoint } from '../scrubMarker';

const LINE = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 2 },
];
const LAP = [
  { lat: 1, lng: 0 },
  { lat: 1, lng: 2 },
];

describe('scrubMarkerPoint', () => {
  it('uses the lap trace when there is one', () => {
    const point = scrubMarkerPoint({
      distanceM: 0,
      lengthM: 100,
      lapPoints: LAP,
      linePoints: LINE,
    });
    expect(point).toEqual({ lat: 1, lng: 0 });
  });

  it('falls back to the section line without a lap', () => {
    const point = scrubMarkerPoint({
      distanceM: 100,
      lengthM: 100,
      lapPoints: undefined,
      linePoints: LINE,
    });
    expect(point).toEqual({ lat: 0, lng: 2 });
  });

  it('gives nothing without a scrub or a length', () => {
    expect(
      scrubMarkerPoint({ distanceM: null, lengthM: 100, lapPoints: LAP, linePoints: LINE })
    ).toBeNull();
    expect(
      scrubMarkerPoint({ distanceM: 5, lengthM: undefined, lapPoints: LAP, linePoints: LINE })
    ).toBeNull();
  });
});

describe('scrubMarkerCollection', () => {
  it('is empty when idle and one point while scrubbing', () => {
    expect(scrubMarkerCollection(null).features).toHaveLength(0);
    const [feature] = scrubMarkerCollection({ lat: 3, lng: 4 }).features;
    expect(feature?.geometry).toEqual({ type: 'Point', coordinates: [4, 3] });
  });
});
