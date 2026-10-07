/**
 * Scenario: zoom the global map in until the activities come out of the
 * consolidated number.
 *
 * Expected behaviour: the count and the points it stands for are never on
 * screen together. The cluster source clustered to zoom 14 while the start
 * points drew from 11, so between the two every ride was a coloured point with
 * its own cluster circle painted over it.
 */

import {
  buildRegionalSources,
  CLUSTER_SOURCE_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapGeoJSONSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function clusterSource() {
  return buildRegionalSources({
    markersGeoJSON: empty,
    sectionsGeoJSON: empty,
    routesGeoJSON: empty,
    userLocationGeoJSON: empty,
    routeGeoJSON: empty,
    spiderPointsGeoJSON: empty,
    spiderLinesGeoJSON: empty,
    heatmapEnabled: false,
  })[CLUSTER_SOURCE_ID] as MapGeoJSONSourceSpec;
}

describe('the handover from the cluster count to the activities own points', () => {
  it('stops clustering at the zoom below the one the points appear at', () => {
    expect(clusterSource().clusterMaxZoom).toBe(TRACE_ZOOM_THRESHOLD - 1);
  });

  it('leaves no zoom drawing both', () => {
    const maxZoom = clusterSource().clusterMaxZoom as number;
    // MapLibre clusters at every zoom up to and including `clusterMaxZoom`,
    // and the start points carry a radius from `TRACE_ZOOM_THRESHOLD` up.
    for (let zoom = 0; zoom <= 22; zoom++) {
      const clustered = zoom <= maxZoom;
      const startPoints = zoom >= TRACE_ZOOM_THRESHOLD;
      expect(clustered && startPoints).toBe(false);
    }
  });
});
