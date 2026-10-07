/**
 * Two-catalogue overlay map for the detection preview.
 *
 * Before a run there is one catalogue, the live one, and it draws as current.
 * After a run, current sections draw dashed underneath, proposed sections
 * solid on top, removed sections dashed in the error colour. Both catalogues
 * toggle through legend chips by swapping source data; the sources and layers
 * themselves never unmount.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { decodeCoords } from 'veloqrs';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { useTheme } from '@/shared/app';
// Straight from the context, not the app barrel: a surface mounted with no
// app shell still has to draw, and the barrel is what such a caller stubs.
import {
  AttributionOverlay,
  type AttributionOverlayRef,
  computeAttribution,
  EMPTY_FEATURE_COLLECTION,
  getNextStyle,
  isDarkStyle,
  getStyleIcon,
  type LngLat,
  type LngLatBounds,
  type MapCameraState,
  type MapStyleType,
  MapSurface,
  type MapSurfaceRef,
  useDrawnMapStyle,
} from '@/features/maps';
import { sectionCameraSpec } from '@/features/routes/lib/sectionMapCamera';
import {
  previewAreaBounds,
  previewCameraBounds,
  type PreviewAreaCentre,
} from '@/features/routes/lib/previewMapCamera';
import type { PreviewResult, PreviewSection } from 'veloqrs';
import {
  buildPreviewLayers,
  buildPreviewSources,
  previewLayerSwatch,
  PREVIEW_INTERACTIVE_LAYERS,
} from './previewMapLayerSpecs';
import { pressable, pressRipple } from '@/shared/ui';

/** Zoom assumed before the surface reports one, matching the camera fallback. */
const DEFAULT_ATTRIBUTION_ZOOM = 11;

/** The delegate hands the bytes over already decoded. */
function decodePolyline(polyline: ArrayBuffer): LngLat[] {
  try {
    return decodeCoords(polyline).map((p) => [p.longitude, p.latitude] as LngLat);
  } catch {
    return [];
  }
}

function lineFeature(section: PreviewSection, coords: LngLat[]): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { id: section.id, status: section.status },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

interface PreviewMapViewProps {
  result: PreviewResult | null;
  /** The live catalogue for the area, drawn until a run supersedes it. */
  currentSections: PreviewSection[];
  /** Selected riding area. The camera never leaves its bin. `PreviewAreaCentre`
   *  carries the `binKey` the camera needs and is a superset of `{lat, lng}`. */
  centre: PreviewAreaCentre | null;
  selectedId: string | null;
  showCurrent: boolean;
  showProposed: boolean;
  showRemoved: boolean;
  onToggleCurrent: () => void;
  onToggleProposed: () => void;
  onToggleRemoved: () => void;
  onSelect: (section: PreviewSection | null) => void;
}

export function PreviewMapView({
  result,
  currentSections,
  centre,
  selectedId,
  showCurrent,
  showProposed,
  showRemoved,
  onToggleCurrent,
  onToggleProposed,
  onToggleRemoved,
  onSelect,
}: PreviewMapViewProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surfaceRef = useRef<MapSurfaceRef>(null);

  // A finished run supersedes the live catalogue for what is proposed and what
  // is gone. A matched row's own line is the proposed one, so the live line it
  // replaces comes from the live catalogue, keyed by the row's live id.
  const sections = useMemo(() => result?.sections ?? currentSections, [result, currentSections]);

  const decoded = useMemo(() => {
    const byId = new Map<string, LngLat[]>();
    for (const section of sections) {
      byId.set(section.id, decodePolyline(section.polyline));
    }
    return byId;
  }, [sections]);

  const liveDecoded = useMemo(() => {
    const byId = new Map<string, LngLat[]>();
    for (const section of currentSections) {
      byId.set(section.id, decodePolyline(section.polyline));
    }
    return byId;
  }, [currentSections]);

  const features = useMemo(() => {
    const current: GeoJSON.Feature[] = [];
    const proposed: GeoJSON.Feature[] = [];
    const gone: GeoJSON.Feature[] = [];
    for (const section of sections) {
      const coords = decoded.get(section.id) ?? [];
      if (coords.length < 2) continue;
      const feature = lineFeature(section, coords);
      // Nothing is proposed until a run finishes, so the live catalogue draws
      // as current alone.
      if (!result) {
        current.push(feature);
        continue;
      }
      // A removed section draws once, through its own layer. It used to go
      // into current as well, which put the same line on the map twice and
      // meant hiding removals left them there in grey.
      if (section.status === 'gone') {
        gone.push(feature);
        continue;
      }
      proposed.push(feature);
      if (section.liveId !== null) {
        const liveCoords = liveDecoded.get(section.liveId) ?? [];
        if (liveCoords.length >= 2) current.push(lineFeature(section, liveCoords));
      }
    }
    return { current, proposed, gone };
  }, [result, sections, decoded, liveDecoded]);

  // The box the camera clamps to, drawn so the athlete can see which ground
  // the selected area covers. Same bounds as the camera and the label, so the
  // three never disagree about what this area is.
  const areaFeatures = useMemo((): GeoJSON.FeatureCollection => {
    const area = previewAreaBounds(centre);
    if (!area) return EMPTY_FEATURE_COLLECTION;
    const [west, south] = area.sw;
    const [east, north] = area.ne;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        },
      ],
    };
  }, [centre]);

  const sources = useMemo(() => {
    const selectedSection = sections.find((s) => s.id === selectedId) ?? null;
    const selectedCoords = selectedSection ? (decoded.get(selectedSection.id) ?? []) : [];
    return buildPreviewSources({
      area: areaFeatures,
      current: showCurrent
        ? { type: 'FeatureCollection', features: features.current }
        : EMPTY_FEATURE_COLLECTION,
      proposed: showProposed
        ? { type: 'FeatureCollection', features: features.proposed }
        : EMPTY_FEATURE_COLLECTION,
      // Removals belong to the current catalogue, but they are routinely most
      // of what the map draws, so they toggle on their own. Reading a diff
      // where removals dominate means being able to take them off without
      // losing the catalogue they came from.
      gone: showRemoved
        ? { type: 'FeatureCollection', features: features.gone }
        : EMPTY_FEATURE_COLLECTION,
      selected:
        selectedSection && selectedCoords.length >= 2
          ? {
              type: 'FeatureCollection',
              features: [lineFeature(selectedSection, selectedCoords)],
            }
          : EMPTY_FEATURE_COLLECTION,
    });
  }, [
    sections,
    decoded,
    features,
    selectedId,
    showCurrent,
    showProposed,
    showRemoved,
    areaFeatures,
  ]);

  const layers = useMemo(() => buildPreviewLayers(), []);

  const bounds = useMemo(
    () => previewCameraBounds(centre, [...decoded.values()]),
    [centre, decoded]
  );

  const initialCamera = useMemo(() => {
    if (bounds) return sectionCameraSpec(bounds);
    const fallback: LngLat = centre ? [centre.lng, centre.lat] : [0, 0];
    return { center: fallback, zoom: 11 };
    // The first camera is a mount-time value; later moves go through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The initial camera is captured once on mount.
  }, []);

  // Frame each area once. Keying the refit on the geometry moved the camera
  // twice a run, once when the sections emptied and again when the result
  // landed, and threw away the athlete's own pan and zoom both times. Comparing
  // two catalogues in one frame is the point of the diff, so a run against the
  // area already framed leaves the viewport alone. Choosing another area is the
  // one event that still justifies moving it.
  const areaKey = centre ? `${centre.lat},${centre.lng}` : null;
  const framedArea = useRef<string | null>(null);
  useEffect(() => {
    if (!bounds || framedArea.current === areaKey) return;
    framedArea.current = areaKey;
    surfaceRef.current?.fitBounds(bounds, 60, 400);
  }, [bounds, areaKey]);

  // Attribution is a licence condition, so the credit line has to name the
  // imagery actually drawn. Satellite sources are regional, so it follows the
  // viewport rather than the area the picker started on.
  const [viewport, setViewport] = useState<{
    center: LngLat;
    zoom: number;
    bounds: LngLatBounds;
  } | null>(null);

  // Every other map in the app takes the athlete's global basemap, and on this
  // one that is wrong: the screen exists to read a diff, and satellite imagery
  // carries as much weight as the lines drawn over it. The street style is the
  // quietest ground the app has, so it opens on that and follows the theme
  // instead of the preference.
  //
  // The ground a proposed section runs over is still a fair question, so the
  // athlete can cycle off it. Until they do, the choice is null and the theme
  // answers, which is what a theme flip mid-screen should still do. The choice
  // is this component's and dies with it: nothing here writes the global
  // preference, so the next visit opens on street again.
  const [chosenStyle, setChosenStyle] = useState<MapStyleType | null>(null);
  const themeStyle: MapStyleType = isDark ? 'dark' : 'light';
  // Imagery is never kept offline, so the satellite choice draws the vector
  // basemap until the connection is back rather than a grey grid.
  const mapStyle: MapStyleType = useDrawnMapStyle(chosenStyle ?? themeStyle);
  const cycleStyle = useCallback(() => {
    setChosenStyle(getNextStyle(mapStyle));
  }, [mapStyle]);
  const attribution = useMemo(
    () =>
      computeAttribution({
        style: mapStyle,
        is3D: false,
        center: viewport?.center ?? (centre ? [centre.lng, centre.lat] : null),
        zoom: viewport?.zoom ?? DEFAULT_ATTRIBUTION_ZOOM,
        bounds: viewport?.bounds ?? null,
      }),
    [mapStyle, viewport, centre]
  );

  // The overlay keeps its own state so a camera move never re-renders the
  // surface, so the text goes in through the ref rather than the prop.
  const attributionRef = useRef<AttributionOverlayRef>(null);
  useEffect(() => {
    attributionRef.current?.setAttribution(attribution);
  }, [attribution]);

  const handleRegionDidChange = useCallback((state: MapCameraState) => {
    setViewport({ center: state.center, zoom: state.zoom, bounds: state.bounds });
  }, []);

  const handlePress = useCallback(
    (event: { feature: { properties: Record<string, unknown> } | null }) => {
      const id = event.feature?.properties?.id;
      const section = sections.find((s) => s.id === id) ?? null;
      onSelect(section);
    },
    [sections, onSelect]
  );

  const chipBg = isDark ? darkColors.surface : colors.surface;
  const chipBorder = isDark ? darkColors.border : colors.border;
  const chipText = isDark ? darkColors.textSecondary : colors.textSecondary;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;

  return (
    <View style={styles.container}>
      <MapSurface
        ref={surfaceRef}
        mapStyle={mapStyle}
        initialCamera={initialCamera}
        sources={sources}
        layers={layers}
        interactiveLayers={PREVIEW_INTERACTIVE_LAYERS}
        onPress={handlePress}
        onRegionDidChange={handleRegionDidChange}
        testID="preview-map"
      />
      <AttributionOverlay
        ref={attributionRef}
        initialAttribution={attribution}
        isDark={isDarkStyle(mapStyle)}
      />
      {/* Opposite corner to the legend, which owns the right-hand side. */}
      <TouchableOpacity
        style={[styles.styleButton, { backgroundColor: chipBg, borderColor: chipBorder }]}
        onPress={cycleStyle}
        activeOpacity={0.8}
        testID="preview-map-style"
        accessibilityRole="button"
        accessibilityLabel={t('maps.toggleStyle')}
      >
        <MaterialCommunityIcons name={getStyleIcon(mapStyle)} size={20} color={textPrimary} />
      </TouchableOpacity>
      <View style={styles.legend} pointerEvents="box-none">
        <LegendChip
          testID="preview-layer-current"
          label={t('settings.previewCurrentLayer')}
          swatch={previewLayerSwatch('current-line')}
          on={showCurrent}
          onPress={onToggleCurrent}
          background={chipBg}
          border={chipBorder}
          text={chipText}
          textOn={textPrimary}
        />
        <LegendChip
          testID="preview-layer-proposed"
          label={t('settings.previewProposedLayer')}
          swatch={previewLayerSwatch('proposed-line')}
          on={showProposed}
          onPress={onToggleProposed}
          background={chipBg}
          border={chipBorder}
          text={chipText}
          textOn={textPrimary}
        />
        {/* The popover's own word for this status, rather than a second key
            carrying the same translation in seventeen locales. */}
        <LegendChip
          testID="preview-layer-removed"
          label={t('settings.previewStatusGone')}
          swatch={previewLayerSwatch('gone-line')}
          on={showRemoved}
          onPress={onToggleRemoved}
          background={chipBg}
          border={chipBorder}
          text={chipText}
          textOn={textPrimary}
        />
      </View>
    </View>
  );
}

/**
 * One legend chip. The chip itself stays neutral so the swatch is the only
 * colour on it and reads as the key it is: a filled swatch means the layer is
 * drawn, a hollow one means it is hidden, and the colour is the line's own.
 */
function LegendChip({
  testID,
  label,
  swatch,
  on,
  onPress,
  background,
  border,
  text,
  textOn,
}: {
  testID: string;
  label: string;
  swatch: string;
  on: boolean;
  onPress: () => void;
  background: string;
  border: string;
  text: string;
  textOn: string;
}) {
  return (
    <Pressable
      style={pressable([
        styles.legendChip,
        { backgroundColor: background, borderColor: border },
        !on && styles.legendChipOff,
      ])}
      android_ripple={pressRipple}
      onPress={onPress}
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <View
        testID={`${testID}-swatch`}
        style={[
          styles.legendSwatch,
          { borderColor: swatch, backgroundColor: on ? swatch : 'transparent' },
        ]}
      />
      <Text style={[styles.legendText, { color: on ? textOn : text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  styleButton: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    padding: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legend: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendChipOff: {
    opacity: 0.6,
  },
  legendSwatch: {
    width: 14,
    height: 4,
    borderRadius: layout.borderRadiusFull,
    borderWidth: 1,
  },
  legendText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
