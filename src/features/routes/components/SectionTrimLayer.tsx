import { ShapeSource, LineLayer } from '@maplibre/maplibre-react-native';

import type { RoutePoint } from '@/types';
import { colors } from '@/theme';

type FeatureOrCollection = GeoJSON.FeatureCollection | GeoJSON.Feature;

interface SectionTrimLayerProps {
  idPrefix: string;
  shadowGeoJSON: FeatureOrCollection;
  extensionGeoJSON: FeatureOrCollection;
  sectionGeoJSON: FeatureOrCollection;
  trimmedGeoJSON: FeatureOrCollection;
  activityColor: string;
  sectionOpacity: number;
  trimRange: { start: number; end: number } | null;
  extensionTrack?: RoutePoint[] | null;
  showExtensionAndSection: boolean;
  trimCasingWidth: number;
  trimLineWidth: number;
}

// Bounds-editing overlays: the faded shadow/extension context and the
// highlighted trimmed portion. Rendered in both the inline and fullscreen maps.
// All ShapeSources always render — conditional removal crashes iOS MapLibre
// during view reconciliation, so visibility is driven by lineOpacity.
export function SectionTrimLayer({
  idPrefix,
  shadowGeoJSON,
  extensionGeoJSON,
  sectionGeoJSON,
  trimmedGeoJSON,
  activityColor,
  sectionOpacity,
  trimRange,
  extensionTrack,
  showExtensionAndSection,
  trimCasingWidth,
  trimLineWidth,
}: SectionTrimLayerProps) {
  return (
    <>
      <ShapeSource id={`${idPrefix}ShadowSource`} shape={shadowGeoJSON}>
        <LineLayer
          id={`${idPrefix}ShadowLine`}
          style={{
            lineColor: colors.gray500,
            lineOpacity: 0.5,
            lineWidth: 3,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {showExtensionAndSection && (
        <>
          <ShapeSource id={`${idPrefix}ExtensionSource`} shape={extensionGeoJSON}>
            <LineLayer
              id={`${idPrefix}ExtensionLineCasing`}
              style={{
                lineColor: '#000000',
                lineOpacity: extensionTrack ? 0.5 : 0,
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id={`${idPrefix}ExtensionLine`}
              style={{
                lineColor: '#FF6B00',
                lineOpacity: extensionTrack ? 1 : 0,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          <ShapeSource id={`${idPrefix}SectionSource`} shape={sectionGeoJSON}>
            <LineLayer
              id={`${idPrefix}SectionLineCasing`}
              style={{
                lineColor: '#FFFFFF',
                lineOpacity: sectionOpacity,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id={`${idPrefix}SectionLine`}
              style={{
                lineColor: activityColor,
                lineOpacity: sectionOpacity,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        </>
      )}

      <ShapeSource id={`${idPrefix}TrimmedSource`} shape={trimmedGeoJSON}>
        <LineLayer
          id={`${idPrefix}TrimmedLineCasing`}
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: trimRange ? 1 : 0,
            lineWidth: trimCasingWidth,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <LineLayer
          id={`${idPrefix}TrimmedLine`}
          style={{
            lineColor: activityColor,
            lineOpacity: trimRange ? 1 : 0,
            lineWidth: trimLineWidth,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>
    </>
  );
}
