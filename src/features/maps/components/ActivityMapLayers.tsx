import { View, Pressable, Text as RNText } from 'react-native';
import { ShapeSource, LineLayer, MarkerView, CircleLayer } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  brand,
  colors,
  sectionPalette,
  sectionPaletteExpression,
  sectionPaletteIndex,
} from '@/theme';
import { LatLng } from '@/shared/geo/polyline';
import { styles } from './ActivityMapView.styles';

type Shape = GeoJSON.FeatureCollection | GeoJSON.Feature;

interface ActivityMapLayersProps {
  overlayGeoJSON: Shape;
  overlayHasData: boolean;
  routeGeoJSON: Shape;
  activityColor: string;
  gradientActive: boolean;
  gradientLineExpression: unknown;
  consolidatedPortionsGeoJSON: Shape;
  sectionBoundariesGeoJSON: Shape;
  // Truthiness-only flag: non-null when section overlays are present.
  sectionOverlaysGeoJSON: unknown[] | null;
  sectionNumberedMarkersGeoJSON: GeoJSON.FeatureCollection;
  sectionPRMarkersGeoJSON: GeoJSON.FeatureCollection;
  highlightGeoJSON: Shape;
  highlightPoint: LatLng | null;
  highlightedSectionId?: string | null;
  startPoint?: LatLng;
  endPoint?: LatLng;
  sectionGeoJSON: Shape;
  sectionStartPoint: LatLng | null;
  sectionEndPoint: LatLng | null;
  startIndex: number | null;
  endIndex: number | null;
  creationMode: boolean;
  onSectionMarkerPress?: (sectionId: string) => void;
}

export function ActivityMapLayers({
  overlayGeoJSON,
  overlayHasData,
  routeGeoJSON,
  activityColor,
  gradientActive,
  gradientLineExpression,
  consolidatedPortionsGeoJSON,
  sectionBoundariesGeoJSON,
  sectionOverlaysGeoJSON,
  sectionNumberedMarkersGeoJSON,
  sectionPRMarkersGeoJSON,
  highlightGeoJSON,
  highlightPoint,
  highlightedSectionId,
  startPoint,
  endPoint,
  sectionGeoJSON,
  sectionStartPoint,
  sectionEndPoint,
  startIndex,
  endIndex,
  creationMode,
  onSectionMarkerPress,
}: ActivityMapLayersProps) {
  return (
    <>
      {/* Route overlay (matched route trace) - rendered first so activity line is on top */}
      {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
      {/* When no data, overlayGeoJSON is an empty FeatureCollection, not null */}
      <ShapeSource id="overlaySource" shape={overlayGeoJSON}>
        <LineLayer
          id="overlayLine"
          style={{
            lineColor: '#00E5FF',
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 0.5,
          }}
        />
      </ShapeSource>

      {/* Route line - render first so section overlays appear on top */}
      {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
      <ShapeSource id="routeSource" shape={routeGeoJSON}>
        <LineLayer
          id="routeLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: sectionOverlaysGeoJSON
              ? highlightedSectionId
                ? 0.25
                : 0.8
              : overlayHasData
                ? 0.85
                : 1,
          }}
        />
        <LineLayer
          id="routeLine"
          style={{
            lineColor: activityColor,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
            // Hide the solid-color line when gradient coloring is active.
            lineOpacity: gradientActive
              ? 0
              : sectionOverlaysGeoJSON
                ? highlightedSectionId
                  ? 0.25
                  : 0.8
                : overlayHasData
                  ? 0.85
                  : 1,
          }}
        />
      </ShapeSource>

      {/* Gradient-coloured route line (requires lineMetrics for line-progress). */}
      {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
      <ShapeSource id="routeGradientSource" shape={routeGeoJSON} lineMetrics={true}>
        <LineLayer
          id="routeLineGradient"
          style={{
            lineColor: activityColor,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
            ...(gradientActive && gradientLineExpression
              ? { lineGradient: gradientLineExpression as unknown as string }
              : {}),
            lineOpacity: gradientActive ? 1 : 0,
          }}
        />
      </ShapeSource>

      {/* Section portion overlays - render after route line so they appear on top.
          One line per section, drawn along the activity's own GPS trace (not the
          averaged section consensus). White casing for contrast, PR gold or section
          palette color for fill. */}
      {/* CRITICAL: Always render stable ShapeSource to avoid Fabric crash */}
      <ShapeSource id="portion-overlays-consolidated" shape={consolidatedPortionsGeoJSON}>
        <LineLayer
          id="portion-overlays-casing"
          style={{
            lineColor: '#FFFFFF',
            lineWidth: highlightedSectionId
              ? ['case', ['==', ['get', 'id'], highlightedSectionId], 7, 5]
              : 6,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: sectionOverlaysGeoJSON
              ? highlightedSectionId
                ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.15]
                : 0.9
              : 0,
          }}
        />
        <LineLayer
          id="portion-overlays-line"
          style={{
            lineColor: highlightedSectionId
              ? [
                  'case',
                  ['==', ['get', 'id'], highlightedSectionId],
                  '#00E5FF',
                  [
                    'case',
                    ['==', ['get', 'isPR'], true],
                    '#D4AF37',
                    sectionPaletteExpression() as unknown as string,
                  ],
                ]
              : [
                  'case',
                  ['==', ['get', 'isPR'], true],
                  '#D4AF37',
                  sectionPaletteExpression() as unknown as string,
                ],
            lineWidth: highlightedSectionId
              ? ['case', ['==', ['get', 'id'], highlightedSectionId], 5, 3]
              : 4,
            lineCap: 'butt',
            lineJoin: 'round',
            // Dashed pattern so overlapping sections are visually
            // distinguishable (you can see the other color showing through the gaps).
            lineDasharray: [2, 1.2],
            lineOpacity: sectionOverlaysGeoJSON
              ? highlightedSectionId
                ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.25]
                : 0.95
              : 0,
          }}
        />
      </ShapeSource>

      {/* Section boundary ticks - perpendicular short line segments at each
          portion's start/end. Always rendered, drawn above portions so section
          breaks are visible even where portions overlap. */}
      <ShapeSource id="section-boundaries" shape={sectionBoundariesGeoJSON}>
        <LineLayer
          id="section-boundaries-casing"
          style={{
            lineColor: '#000000',
            lineWidth: 6,
            lineCap: 'round',
            lineOpacity: 0.45,
          }}
        />
        <LineLayer
          id="section-boundaries-line"
          style={{
            lineColor: '#FFFFFF',
            lineWidth: 3.5,
            lineCap: 'round',
            lineOpacity: 1,
          }}
        />
      </ShapeSource>

      {/* Start marker */}
      {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
      <MarkerView coordinate={startPoint ? [startPoint.longitude, startPoint.latitude] : [0, 0]}>
        <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
          <View style={[styles.marker, styles.startMarker]} />
        </View>
      </MarkerView>

      {/* End marker */}
      {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
      <MarkerView coordinate={endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]}>
        <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
          <View style={[styles.marker, styles.endMarker]} />
        </View>
      </MarkerView>

      {/* Section creation: selected section line */}
      {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
      <ShapeSource id="sectionSource" shape={sectionGeoJSON}>
        <LineLayer
          id="sectionLine"
          style={{
            lineColor: colors.success,
            lineWidth: 6,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {/* Section creation: start marker */}
      {/* CRITICAL: Always render to avoid camera reset when marker appears */}
      {/* Use activity start as fallback to stay within map bounds (not [0,0]) */}
      {/* Key includes startIndex to force position update (stable when null) */}
      <MarkerView
        key={`section-start-${startIndex ?? 'none'}`}
        coordinate={
          sectionStartPoint
            ? [sectionStartPoint.longitude, sectionStartPoint.latitude]
            : startPoint
              ? [startPoint.longitude, startPoint.latitude]
              : [0, 0]
        }
        allowOverlap={true}
      >
        <View
          style={[styles.markerContainer, { opacity: creationMode && sectionStartPoint ? 1 : 0 }]}
        >
          <View style={[styles.sectionCreationMarker, styles.sectionStartMarker]}>
            <MaterialCommunityIcons name="flag-outline" size={16} color={colors.textOnDark} />
          </View>
        </View>
      </MarkerView>

      {/* Section creation: end marker */}
      {/* CRITICAL: Always render to avoid camera reset when marker appears */}
      {/* Use activity end as fallback to stay within map bounds (not [0,0]) */}
      {/* Key includes endIndex to force position update (stable when null) */}
      <MarkerView
        key={`section-end-${endIndex ?? 'none'}`}
        coordinate={
          sectionEndPoint
            ? [sectionEndPoint.longitude, sectionEndPoint.latitude]
            : endPoint
              ? [endPoint.longitude, endPoint.latitude]
              : [0, 0]
        }
        allowOverlap={true}
      >
        <View
          style={[styles.markerContainer, { opacity: creationMode && sectionEndPoint ? 1 : 0 }]}
        >
          <View style={[styles.sectionCreationMarker, styles.sectionEndMarker]}>
            <MaterialCommunityIcons name="flag" size={16} color={colors.textOnDark} />
          </View>
        </View>
      </MarkerView>

      {/* Numbered section markers - one MarkerView per non-PR section.
          MarkerView is used here (not a ShapeSource + CircleLayer) because
          @maplibre/maplibre-react-native's boolean filters don't reliably
          render on native, and MarkerView with React children always does.
          Each badge uses the section's palette color to match the row. */}
      {sectionNumberedMarkersGeoJSON.features.map((f) => {
        const geom = f.geometry as GeoJSON.Point;
        const coord = geom?.coordinates as [number, number] | undefined;
        const sectionId = f.properties?.sectionId as string | undefined;
        const label = f.properties?.label as string | undefined;
        if (!coord || !sectionId || !label) return null;
        const color = sectionPalette[sectionPaletteIndex(sectionId)];
        return (
          <MarkerView key={`num-${sectionId}`} coordinate={coord} allowOverlap={true}>
            <Pressable
              onPress={() => onSectionMarkerPress?.(sectionId)}
              style={[styles.sectionNumberBadge, { backgroundColor: color }]}
            >
              <RNText style={styles.sectionNumberBadgeText}>{label}</RNText>
            </Pressable>
          </MarkerView>
        );
      })}
      {/* PR section markers - vector trophy via MarkerView, matches feed cards. */}
      {sectionPRMarkersGeoJSON.features.map((f) => {
        const geom = f.geometry as GeoJSON.Point;
        const coord = geom?.coordinates as [number, number] | undefined;
        const sectionId = f.properties?.sectionId as string | undefined;
        if (!coord || !sectionId) return null;
        return (
          <MarkerView key={`pr-${sectionId}`} coordinate={coord} allowOverlap={true}>
            <Pressable
              onPress={() => onSectionMarkerPress?.(sectionId)}
              style={styles.prTrophyMarker}
            >
              <MaterialCommunityIcons name="trophy" size={14} color={brand.gold} />
            </Pressable>
          </MarkerView>
        );
      })}

      {/* Highlight marker from chart scrubbing - rendered last so it's on top of all layers */}
      {/* Uses ShapeSource + CircleLayer because MarkerView coordinate updates break native position binding */}
      <ShapeSource id="highlightSource" shape={highlightGeoJSON}>
        <CircleLayer
          id="highlight-border"
          style={{
            circleRadius: 7,
            circleColor: '#FFFFFF',
            circleOpacity: highlightPoint ? 1 : 0,
          }}
        />
        <CircleLayer
          id="highlight-fill"
          style={{
            circleRadius: 5,
            circleColor: sectionPalette[0],
            circleOpacity: highlightPoint ? 1 : 0,
          }}
        />
      </ShapeSource>
    </>
  );
}
