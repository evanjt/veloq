/**
 * Scenario: the Routes tab draws the route's representative over the
 * activity's map, from the signature the detail read carries.
 *
 * Expected behaviour: the line is the decoded signature on the Routes tab, and
 * nothing on any other tab, for an activity in no route or for a signature
 * that will not decode.
 */
import { encodeTrack } from '@/__tests__/__shared__/trackBytes';
import { routeOverlayLine } from '../routeOverlayLine';

const points = [
  { latitude: 46.5, longitude: 6.6 },
  { latitude: 46.501, longitude: 6.602 },
  { latitude: 46.503, longitude: 6.605 },
];

describe('the activity Routes tab overlay line', () => {
  it('decodes the representative signature on the Routes tab', () => {
    const line = routeOverlayLine({ representativeSignature: encodeTrack(points) }, 'routes');

    expect(line).toHaveLength(points.length);
    line?.forEach((point, i) => {
      expect(point.latitude).toBeCloseTo(points[i].latitude, 6);
      expect(point.longitude).toBeCloseTo(points[i].longitude, 6);
    });
  });

  it('draws nothing on another tab', () => {
    expect(routeOverlayLine({ representativeSignature: encodeTrack(points) }, 'charts')).toBeNull();
  });

  it('draws nothing for an activity in no route', () => {
    expect(routeOverlayLine({ representativeSignature: new ArrayBuffer(0) }, 'routes')).toBeNull();
    expect(routeOverlayLine(undefined, 'routes')).toBeNull();
  });

  it('draws nothing for a signature cut short', () => {
    const torn = encodeTrack(points).slice(0, 4);
    expect(routeOverlayLine({ representativeSignature: torn }, 'routes')).toBeNull();
  });
});
