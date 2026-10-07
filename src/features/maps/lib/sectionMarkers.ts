import { sectionPaletteIndex } from '@/theme';
import type { SectionOverlayGeoJSON } from '../hooks/useMapLayers';

const MARKER_OFFSET = 0.00035; // ~35 meters at the equator

function markerPosition(overlay: SectionOverlayGeoJSON): [number, number] | null {
  const sectionGeom = overlay.sectionGeo?.geometry as GeoJSON.LineString | undefined;
  const portionGeom = overlay.portionGeo?.geometry as GeoJSON.LineString | undefined;
  const coords = portionGeom?.coordinates || sectionGeom?.coordinates;
  if (!coords || coords.length < 2) return null;

  const midIndex = Math.floor(coords.length / 2);
  const midCoord = coords[midIndex];
  if (
    !midCoord ||
    typeof midCoord[0] !== 'number' ||
    typeof midCoord[1] !== 'number' ||
    !Number.isFinite(midCoord[0]) ||
    !Number.isFinite(midCoord[1])
  ) {
    return null;
  }

  const prevCoord = coords[Math.max(0, midIndex - 1)];
  const nextCoord = coords[Math.min(coords.length - 1, midIndex + 1)];
  const [prevLng, prevLat] = prevCoord ?? [];
  const [nextLng, nextLat] = nextCoord ?? [];
  if (
    prevLng === undefined ||
    prevLat === undefined ||
    nextLng === undefined ||
    nextLat === undefined
  ) {
    return null;
  }
  const dx = nextLng - prevLng;
  const dy = nextLat - prevLat;
  const len = Math.sqrt(dx * dx + dy * dy);

  const lng = midCoord[0] + (len > 0 ? (-dy / len) * MARKER_OFFSET : 0);
  const lat = midCoord[1] + (len > 0 ? (dx / len) * MARKER_OFFSET : 0);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/**
 * Section markers for the activity map.
 *
 * PR markers are one per PR overlay. Numbered markers are one per section
 * (an overlay exists per direction), labelled from the Sections-tab row for
 * that section, so a section with no row or no drawable geometry gets no
 * marker and never shifts another's number.
 */
export function buildSectionMarkers(
  overlays: SectionOverlayGeoJSON[],
  rowLabels: ReadonlyMap<string, string>,
  isPRMarker: boolean
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const placed = new Set<string>();

  for (const overlay of overlays) {
    if (isPRMarker ? !overlay.isPR : placed.has(overlay.id)) continue;
    const label = isPRMarker ? 'PR' : rowLabels.get(overlay.id);
    if (label === undefined) continue;
    const position = markerPosition(overlay);
    if (!position) continue;
    placed.add(overlay.id);

    features.push({
      type: 'Feature',
      properties: {
        sectionId: overlay.id,
        label,
        isPR: isPRMarker,
        colorIndex: sectionPaletteIndex(overlay.id),
      },
      geometry: { type: 'Point', coordinates: position },
    });
  }

  return { type: 'FeatureCollection', features };
}
