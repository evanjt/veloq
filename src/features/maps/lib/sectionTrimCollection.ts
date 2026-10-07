type FeatureOrCollection = GeoJSON.FeatureCollection | GeoJSON.Feature;

interface SectionTrimInput {
  trimRange: { start: number; end: number } | null | undefined;
  /** The kept portion, already cut from the line the trim indices point into. */
  trimmed: FeatureOrCollection;
  /** The longer track the handles slide along in expand mode. */
  extension: FeatureOrCollection;
  /** Start and end points at the trimmed positions, tagged by `position`. */
  endpoints: GeoJSON.FeatureCollection;
}

function featuresOf(data: FeatureOrCollection): GeoJSON.Feature[] {
  return data.type === 'FeatureCollection' ? data.features : [data];
}

function tag(feature: GeoJSON.Feature, kind: string): GeoJSON.Feature {
  return { ...feature, properties: { ...feature.properties, kind } };
}

// One collection for everything the 3D page draws over the full section line
// while bounds are edited, so a drag is a single patch. The same geometry the
// 2D layers use goes in, so both views read one source. Empty means no trim.
export function buildSectionTrimCollection({
  trimRange,
  trimmed,
  extension,
  endpoints,
}: SectionTrimInput): GeoJSON.FeatureCollection {
  if (!trimRange) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      ...featuresOf(extension).map((f) => tag(f, 'extension')),
      ...featuresOf(trimmed).map((f) => tag(f, 'trimmed')),
      ...endpoints.features.map((f) => tag(f, String(f.properties?.position ?? 'start'))),
    ],
  };
}
