/**
 * Two-catalogue overlay map for the detection preview.
 *
 * Current sections draw dashed underneath, proposed sections solid on top,
 * removed sections dashed in the error colour. Both catalogues toggle through
 * legend chips by swapping source data; the sources and layers themselves
 * never unmount.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decodeCoords } from 'veloqrs';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { MapSurface, type MapSurfaceRef } from '@/features/maps/components';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
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
  PREVIEW_INTERACTIVE_LAYERS,
} from './previewMapLayerSpecs';

const SURFACE_STYLE_OPTIONS = { bundledLightStyle: true, cacheVectorTiles: true } as const;

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
  /** Selected riding area. The camera never leaves its bin. */
  centre: PreviewAreaCentre | null;
  selectedId: string | null;
  showCurrent: boolean;
  showProposed: boolean;
  onToggleCurrent: () => void;
  onToggleProposed: () => void;
  onSelect: (section: PreviewSection | null) => void;
}

export function PreviewMapView({
  result,
  centre,
  selectedId,
  showCurrent,
  showProposed,
  onToggleCurrent,
  onToggleProposed,
  onSelect,
}: PreviewMapViewProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { getGlobalMapStyle } = useMapPreferences();
  const surfaceRef = useRef<MapSurfaceRef>(null);

  const decoded = useMemo(() => {
    const byId = new Map<string, LngLat[]>();
    for (const section of result?.sections ?? []) {
      byId.set(section.id, decodePolyline(section.polylineBase64));
    }
    return byId;
  }, [result]);

  const features = useMemo(() => {
    const current: GeoJSON.Feature[] = [];
    const proposed: GeoJSON.Feature[] = [];
    const gone: GeoJSON.Feature[] = [];
    for (const section of result?.sections ?? []) {
      const coords = decoded.get(section.id) ?? [];
      if (coords.length < 2) continue;
      const feature = lineFeature(section, coords);
      if (section.status === 'gone') gone.push(feature);
      else proposed.push(feature);
      if (section.liveId !== null) current.push(feature);
    }
    return { current, proposed, gone };
  }, [result, decoded]);

  const sources = useMemo(() => {
    const selectedSection = result?.sections.find((s) => s.id === selectedId) ?? null;
    const selectedCoords = selectedSection ? (decoded.get(selectedSection.id) ?? []) : [];
    return buildPreviewSources({
      current: showCurrent
        ? { type: 'FeatureCollection', features: features.current }
        : EMPTY_FEATURE_COLLECTION,
      proposed: showProposed
        ? { type: 'FeatureCollection', features: features.proposed }
        : EMPTY_FEATURE_COLLECTION,
      // Gone lines belong to the current catalogue: they are what the live
      // config keeps and the proposed one retires.
      gone: showCurrent
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
  }, [result, decoded, features, selectedId, showCurrent, showProposed]);

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

  useEffect(() => {
    if (bounds) surfaceRef.current?.fitBounds(bounds, 60, 400);
  }, [bounds]);

  const handlePress = useCallback(
    (event: { feature: { properties: Record<string, unknown> } | null }) => {
      const id = event.feature?.properties?.id;
      const section = result?.sections.find((s) => s.id === id) ?? null;
      onSelect(section);
    },
    [result, onSelect]
  );

  const chipBg = isDark ? darkColors.surface : colors.surface;
  const chipBorder = isDark ? darkColors.border : colors.border;
  const chipText = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.container}>
      <MapSurface
        ref={surfaceRef}
        mapStyle={getGlobalMapStyle()}
        styleOptions={SURFACE_STYLE_OPTIONS}
        initialCamera={initialCamera}
        sources={sources}
        layers={layers}
        interactiveLayers={PREVIEW_INTERACTIVE_LAYERS}
        onPress={handlePress}
        testID="preview-map"
      />
      <View style={styles.legend} pointerEvents="box-none">
        <Pressable
          style={[
            styles.legendChip,
            { backgroundColor: chipBg, borderColor: chipBorder },
            showCurrent && styles.legendChipActive,
          ]}
          onPress={onToggleCurrent}
          testID="preview-layer-current"
        >
          <Text style={[styles.legendText, { color: showCurrent ? colors.textOnDark : chipText }]}>
            {t('settings.previewCurrentLayer')}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.legendChip,
            { backgroundColor: chipBg, borderColor: chipBorder },
            showProposed && styles.legendChipActive,
          ]}
          onPress={onToggleProposed}
          testID="preview-layer-proposed"
        >
          <Text style={[styles.legendText, { color: showProposed ? colors.textOnDark : chipText }]}>
            {t('settings.previewProposedLayer')}
          </Text>
        </Pressable>
      </View>
    </View>
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendChipActive: {
    backgroundColor: brand.tealLight,
    borderColor: brand.tealLight,
  },
  legendText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
