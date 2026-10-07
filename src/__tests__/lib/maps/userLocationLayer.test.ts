/**
 * Scenario: the location dot's source is never mounted conditionally, so with
 * no fix it is an empty collection and the circles are drawn at zero opacity.
 *
 * Expected behaviour: one builder gives the collection and one gives the layers.
 */

import {
  USER_LOCATION_SOURCE_ID,
  buildUserLocationCollection,
  buildUserLocationLayers,
} from '@/features/maps/lib/userLocationLayer';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';

describe('buildUserLocationCollection', () => {
  it('is the empty collection with no fix', () => {
    expect(buildUserLocationCollection(null)).toBe(EMPTY_FEATURE_COLLECTION);
  });

  it('is one point at the fix', () => {
    const collection = buildUserLocationCollection([7.5, 46.5]);
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry).toEqual({ type: 'Point', coordinates: [7.5, 46.5] });
  });
});

describe('buildUserLocationLayers', () => {
  const opacities = (hasFix: boolean) =>
    buildUserLocationLayers(hasFix).map(
      (layer) => (layer.paint as Record<string, unknown>)['circle-opacity']
    );

  it('keeps both circles on the dot source whether or not a fix is held', () => {
    for (const hasFix of [true, false]) {
      const layers = buildUserLocationLayers(hasFix);
      expect(layers.map((l) => l.id)).toEqual(['user-location-outer', 'user-location-inner']);
      expect(layers.every((l) => l.source === USER_LOCATION_SOURCE_ID)).toBe(true);
    }
  });

  it('hides the circles with no fix and shows them with one', () => {
    expect(opacities(false)).toEqual([0, 0]);
    expect(opacities(true)).toEqual([0.3, 1]);
  });
});
