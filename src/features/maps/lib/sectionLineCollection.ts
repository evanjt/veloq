/**
 * The section overlay the map read returns, as the GeoJSON collection the map draws and the
 * fields the chooser lists.
 *
 * The engine stamps the overlay with the database state it was read in, and the cache keeps
 * what it decoded while the stamp is unchanged, so a filter change that re-reads the map
 * hands MapLibre the same collection object rather than a new one to compare.
 */
import { decodeCoordsFlat } from 'veloqrs/src/coords';
import { sectionPalette, sectionPaletteIndex } from '@/theme/colors';
import { EMPTY_FEATURE_COLLECTION } from './coordinates';
import { createLayerHold } from './mapLayerHold';

/** A section as the overlay lists it. The line is drawn from the collection. */
export interface MapSection {
  id: string;
  name: string;
  visitCount: number;
  distanceMeters: number;
}

export interface MapSectionInput {
  id: string;
  name?: string | undefined;
  visitCount: number;
  distanceMeters: number;
  encodedPolyline: ArrayBuffer;
}

export interface MapSectionLayerInput {
  stamp?: number | undefined;
  /** Absent when the read was answered under the stamp the caller holds */
  sections?: MapSectionInput[] | undefined;
}

export interface MapSectionOverlay {
  sections: MapSection[];
  collection: GeoJSON.FeatureCollection;
}

const EMPTY_OVERLAY: MapSectionOverlay = { sections: [], collection: EMPTY_FEATURE_COLLECTION };

function buildOverlay(input: MapSectionInput[]): MapSectionOverlay {
  const sections: MapSection[] = [];
  const features: GeoJSON.Feature[] = [];
  for (const section of input) {
    const listed: MapSection = {
      id: section.id,
      name: section.name ?? '',
      visitCount: section.visitCount,
      distanceMeters: section.distanceMeters,
    };
    sections.push(listed);
    const flat = decodeCoordsFlat(section.encodedPolyline);
    const coordinates: number[][] = [];
    for (let at = 0; at + 1 < flat.length; at += 2) {
      const lat = flat[at];
      const lng = flat[at + 1];
      // A non-finite pair in a LineString crashes the iOS renderer.
      if (lat === undefined || lng === undefined) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      coordinates.push([lng, lat]);
    }
    // One point is not a line, and the renderer crashes on it.
    if (coordinates.length < 2) continue;
    features.push({
      type: 'Feature',
      id: section.id,
      // Keyed by id so the colour matches the activity map and survives a re-order.
      properties: { ...listed, color: sectionPalette[sectionPaletteIndex(section.id)] },
      geometry: { type: 'LineString', coordinates },
    });
  }
  return { sections, collection: { type: 'FeatureCollection', features } };
}

export function createSectionLineCache() {
  const hold = createLayerHold<MapSectionLayerInput, MapSectionOverlay>(EMPTY_OVERLAY, (layer) =>
    layer.sections ? buildOverlay(layer.sections) : undefined
  );
  return {
    /** The stamp to pass back to the next map read */
    stamp: hold.stamp,
    /** The overlay for the layer a read returned, or the empty one while it is off */
    overlay: hold.take,
  };
}
