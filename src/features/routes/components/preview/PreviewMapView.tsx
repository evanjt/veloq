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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decodeCoords } from 'veloqrs';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import {
  AttributionOverlay,
  MapSurface,
  type AttributionOverlayRef,
  type MapCameraState,
  type MapSurfaceRef,
} from '@/features/maps/components';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { EMPTY_FEATURE_COLLECTION, type LngLat } from '@/features/maps/lib/coordinates';
import { sectionCameraSpec } from '@/features/routes/lib/sectionMapCamera';
import {
  previewCameraBounds,
  type PreviewAreaCentre,
} from '@/features/routes/lib/previewMapCamera';
import type {
  PreviewResult,
  PreviewSection,
} from '../../../../../modules/veloqrs/src/delegates/preview';
import {
  buildPreviewLayers,
  buildPreviewSources,
  previewLayerSwatch,
  PREVIEW_INTERACTIVE_LAYERS,
} from './previewMapLayerSpecs';

/** Zoom assumed before the surface reports one, matching the camera fallback. */
const DEFAULT_ATTRIBUTION_ZOOM = 11;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function decodePolyline(base64: string): LngLat[] {
  try {
    return decodeCoords(base64ToArrayBuffer(base64)).map(
      (p) => [p.longitude, p.latitude] as LngLat
    );
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

  // A finished run supersedes the live catalogue: its rows already carry the
  // current sections, as matched rows and as gone ones.
  const sections = useMemo(() => result?.sections ?? currentSections, [result, currentSections]);

  const decoded = useMemo(() => {
    const byId = new Map<string, LngLat[]>();
    for (const section of sections) {
      byId.set(section.id, decodePolyline(section.polylineBase64));
    }
    return byId;
  }, [sections]);

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
      // meant hiding removals left them there in grey (B408).
      if (section.status === 'gone') {
        gone.push(feature);
        continue;
      }
      proposed.push(feature);
      if (section.liveId !== null) current.push(feature);
    }
    return { current, proposed, gone };
  }, [result, sections, decoded]);

  const sources = useMemo(() => {
    const selectedSection = sections.find((s) => s.id === selectedId) ?? null;
    const selectedCoords = selectedSection ? (decoded.get(selectedSection.id) ?? []) : [];
    return buildPreviewSources({
      current: showCurrent
        ? { type: 'FeatureCollection', features: features.current }
        : EMPTY_FEATURE_COLLECTION,
      proposed: showProposed
        ? { type: 'FeatureCollection', features: features.proposed }
        : EMPTY_FEATURE_COLLECTION,
      // Removals belong to the current catalogue, but they are routinely most
      // of what the map draws, so they toggle on their own. Reading a diff
      // where removals dominate means being able to take them off without
      // losing the catalogue they came from (B408).
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
  }, [sections, decoded, features, selectedId, showCurrent, showProposed, showRemoved]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  } | null>(null);

  // Every other map in the app takes the athlete's global basemap, and on this
  // one that is wrong: the screen exists to read a diff, and satellite imagery
  // carries as much weight as the lines drawn over it. The street style is the
  // quietest ground the app has, so it takes that and follows the theme
  // instead of the preference (B407).
  const mapStyle: MapStyleType = isDark ? 'dark' : 'light';
  const attribution = useMemo(
    () =>
      computeAttribution({
        style: mapStyle,
        is3D: false,
        center: viewport?.center ?? (centre ? [centre.lng, centre.lat] : null),
        zoom: viewport?.zoom ?? DEFAULT_ATTRIBUTION_ZOOM,
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
    setViewport({ center: state.center, zoom: state.zoom });
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
      <AttributionOverlay ref={attributionRef} initialAttribution={attribution} />
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
      style={[
        styles.legendChip,
        { backgroundColor: background, borderColor: border },
        !on && styles.legendChipOff,
      ]}
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
    borderRadius: 2,
    borderWidth: 1,
  },
  legendText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
