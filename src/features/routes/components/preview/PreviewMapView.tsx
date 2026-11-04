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
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { decodeCoords } from 'veloqrs';
import {
  cameraMove,
  colors,
  darkColors,
  layout,
  mapPalette,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
  sectionPalette,
  sectionPaletteIndex,
} from '@/theme';
import { useTheme } from '@/shared/app';
// Straight from the context, not the app barrel: a surface mounted with no
// app shell still has to draw, and the barrel is what such a caller stubs.
import {
  AttributionOverlay,
  EMPTY_FEATURE_COLLECTION,
  getStyleIcon,
  type LngLat,
  type MapStyleType,
  MapControlButton,
  MapSurface,
  type MapSurfaceRef,
  useMapStyleToggle,
  useSurfaceAttribution,
} from '@/features/maps';
import { sectionCameraSpec } from '@/features/routes/lib/sectionMapCamera';
import {
  previewCameraBounds,
  type PreviewAreaCentre,
} from '@/features/routes/lib/previewMapCamera';
import { previewAreaOutline } from '@/features/routes/lib/previewAreaOutline';
import type { PreviewResult, PreviewSection } from 'veloqrs';
import type { RetiredLines } from '@/features/routes/lib/retiredLineCollection';
import {
  buildPreviewLayers,
  buildPreviewSources,
  previewLayerSwatch,
  PREVIEW_INTERACTIVE_LAYERS,
} from './previewMapLayerSpecs';
import { buildPreviewKey, type PreviewKeyEntry } from './previewKey';
import { PressTarget } from '@/shared/ui';

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
    properties: {
      id: section.id,
      status: section.status,
      color: sectionPalette[sectionPaletteIndex(section.id)],
    },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

/** The old-versus-new layer: what the re-cut retired, drawn beside what replaced it. */
export interface RetiredLayerProps {
  lines: RetiredLines;
  show: boolean;
  onToggle: () => void;
  /** A retired section the camera frames on, in place of the whole area. */
  frameId?: string | null;
  /** A retired line, or a hidden current one, was tapped. */
  onSelect: (id: string) => void;
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
  showRemoved: boolean;
  onToggleCurrent: () => void;
  onToggleRemoved: () => void;
  onSelect: (section: PreviewSection | null) => void;
  retiredLayer?: RetiredLayerProps | null | undefined;
  /** The screen shows the old-versus-new layer alone, so the settings preview's statuses are left out. */
  retiredOnly?: boolean;
}

export function PreviewMapView({
  result,
  currentSections,
  centre,
  selectedId,
  showCurrent,
  showRemoved,
  onToggleCurrent,
  onToggleRemoved,
  onSelect,
  retiredLayer = null,
  retiredOnly = false,
}: PreviewMapViewProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surfaceRef = useRef<MapSurfaceRef>(null);
  const screenFocused = useIsFocused();

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
  const areaFeatures = useMemo(() => previewAreaOutline(centre), [centre]);

  const retiredShown = retiredLayer !== null && retiredLayer.show;

  const { current: currentFeatures, proposed: proposedFeatures, gone: goneFeatures } = features;
  const sources = useMemo(() => {
    const selectedSection = sections.find((s) => s.id === selectedId) ?? null;
    const selectedCoords = selectedSection ? (decoded.get(selectedSection.id) ?? []) : [];
    return buildPreviewSources({
      // The retired screen reads two kinds of line against each other. The
      // settings area box and the preview's own catalogue are not part of it:
      // the catalogue comes from the retired read, whose lines carry the
      // selection role, so a tap and a dim reach every current line.
      area: retiredOnly ? EMPTY_FEATURE_COLLECTION : areaFeatures,
      current: retiredOnly
        ? showCurrent && retiredShown
          ? retiredLayer.lines.current
          : EMPTY_FEATURE_COLLECTION
        : showCurrent
          ? { type: 'FeatureCollection', features: currentFeatures }
          : EMPTY_FEATURE_COLLECTION,
      proposed: { type: 'FeatureCollection', features: proposedFeatures },
      // Removals belong to the current catalogue, but they are routinely most
      // of what the map draws, so they toggle on their own. Reading a diff
      // where removals dominate means being able to take them off without
      // losing the catalogue they came from.
      gone: showRemoved
        ? { type: 'FeatureCollection', features: goneFeatures }
        : EMPTY_FEATURE_COLLECTION,
      retired: retiredShown ? retiredLayer.lines.retired : EMPTY_FEATURE_COLLECTION,
      retiredCurrent:
        retiredShown && !retiredOnly ? retiredLayer.lines.current : EMPTY_FEATURE_COLLECTION,
      retiredSelection: retiredShown ? retiredLayer.lines.selection : EMPTY_FEATURE_COLLECTION,
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
    currentFeatures,
    proposedFeatures,
    goneFeatures,
    selectedId,
    showCurrent,
    showRemoved,
    areaFeatures,
    retiredShown,
    retiredLayer,
    retiredOnly,
  ]);

  // The retired lines count towards the frame while they are drawn, so a re-cut
  // that moved a line outside the live catalogue's extent is still in view.
  const retiredGeometries = useMemo(() => {
    if (!retiredShown) return [];
    return retiredLayer.lines.retired.features.flatMap((f) =>
      f.geometry.type === 'LineString' ? [f.geometry.coordinates as LngLat[]] : []
    );
  }, [retiredShown, retiredLayer]);

  const frameId = retiredLayer?.frameId ?? null;
  const framedLine = useMemo(() => {
    if (!frameId || !retiredLayer) return null;
    const feature = retiredLayer.lines.retired.features.find((f) => f.properties?.id === frameId);
    return feature?.geometry.type === 'LineString'
      ? (feature.geometry.coordinates as LngLat[])
      : null;
  }, [frameId, retiredLayer]);

  const bounds = useMemo(
    () =>
      previewCameraBounds(
        centre,
        framedLine ? [framedLine] : [...decoded.values(), ...retiredGeometries]
      ),
    [centre, decoded, retiredGeometries, framedLine]
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
    surfaceRef.current?.fitBounds(bounds, 60, cameraMove.brisk);
  }, [bounds, areaKey]);

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
  const { drawn: mapStyle, cycle: cycleStyle } = useMapStyleToggle(
    chosenStyle ?? themeStyle,
    setChosenStyle
  );
  const palette = mapPalette(mapStyle);
  const ranDiff = result !== null;
  const layers = useMemo(
    () => buildPreviewLayers(palette, retiredOnly, ranDiff),
    [palette, retiredOnly, ranDiff]
  );
  const hasArea = !retiredOnly && areaFeatures.features.length > 0;
  const key = useMemo(
    () => buildPreviewKey(result?.counts ?? null, palette, hasArea),
    [result, palette, hasArea]
  );
  // Satellite sources are regional, so the credit follows the viewport rather
  // than the area the picker started on.
  const { attributionRef, initialAttribution, trackAttribution } = useSurfaceAttribution(mapStyle, {
    center: centre ? [centre.lng, centre.lat] : null,
  });

  const handlePress = useCallback(
    (event: { feature: { properties: Record<string, unknown> } | null }) => {
      const id = event.feature?.properties?.id;
      // Only the retired layers stamp a layer on their features; the preview's
      // own lines carry an id and a status.
      if (typeof id === 'string' && typeof event.feature?.properties?.layer === 'string') {
        retiredLayer?.onSelect(id);
        return;
      }
      const section = sections.find((s) => s.id === id) ?? null;
      onSelect(section);
    },
    [sections, onSelect, retiredLayer]
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
        released={!screenFocused}
        onPress={handlePress}
        onRegionDidChange={trackAttribution}
        testID="preview-map"
      />
      <AttributionOverlay ref={attributionRef} initialAttribution={initialAttribution} />
      {/* Opposite corner to the legend, which owns the right-hand side. */}
      <MapControlButton
        style={styles.styleButton}
        onPress={cycleStyle}
        testID="preview-map-style"
        accessibilityLabel={t('maps.toggleStyle')}
      >
        <MapControlButton.Glyph name={getStyleIcon(mapStyle)} />
      </MapControlButton>
      {/* One row that scrolls rather than wraps, so the key never stacks over the lines. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.legend}
        contentContainerStyle={styles.legendContent}
        testID="preview-key"
      >
        {retiredOnly ? (
          <LegendChip
            testID="preview-layer-current"
            label={t('settings.previewCurrentLayer')}
            swatch={previewLayerSwatch('current-line', palette, true)}
            on={showCurrent}
            onPress={onToggleCurrent}
            background={chipBg}
            border={chipBorder}
            text={chipText}
            textOn={textPrimary}
          />
        ) : (
          key.map((entry) => (
            <LegendChip
              key={entry.id}
              testID={`preview-layer-${entry.id}`}
              label={keyLabel(entry, t)}
              swatch={entry.id === 'area' ? chipText : entry.swatch}
              dashed={entry.dashed}
              on={entry.id === 'current' ? showCurrent : entry.id === 'gone' ? showRemoved : true}
              onPress={
                entry.id === 'current'
                  ? onToggleCurrent
                  : entry.id === 'gone'
                    ? onToggleRemoved
                    : undefined
              }
              background={chipBg}
              border={chipBorder}
              text={chipText}
              textOn={textPrimary}
            />
          ))
        )}
        {retiredOnly && retiredLayer ? (
          <LegendChip
            testID="preview-layer-retired"
            label={t('settings.previewRetiredLayer')}
            swatch={previewLayerSwatch('retired-line', palette, true)}
            dashed
            on={retiredLayer.show}
            onPress={retiredLayer.onToggle}
            background={chipBg}
            border={chipBorder}
            text={chipText}
            textOn={textPrimary}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function keyLabel(entry: PreviewKeyEntry, t: TFunction): string {
  switch (entry.id) {
    case 'current':
      return t('settings.previewCurrentLayer');
    case 'area':
      return t('settings.previewAreaLayer');
    case 'unchanged':
      return t('settings.previewUnchanged', { count: entry.count });
    case 'changed':
      return t('settings.previewChanged', { count: entry.count });
    case 'new':
      return t('settings.previewNew', { count: entry.count });
    case 'gone':
      return t('settings.previewGone', { count: entry.count });
    default:
      return entry.id;
  }
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
  dashed = false,
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
  dashed?: boolean;
  on: boolean;
  /** Absent for a category that is only a key entry. */
  onPress?: (() => void) | undefined;
  background: string;
  border: string;
  text: string;
  textOn: string;
}) {
  return (
    <PressTarget
      style={[
        styles.legendChip,
        { backgroundColor: background, borderColor: border },
        !on && styles.legendChipOff,
      ]}
      hitSlop={legendChipSlop}
      onPress={onPress}
      testID={testID}
      accessibilityRole={onPress ? 'switch' : 'text'}
      accessibilityState={onPress ? { checked: on } : {}}
      accessibilityLabel={label}
    >
      {dashed ? (
        // Three short bars, the way the map dashes the line this entry keys.
        <View testID={`${testID}-swatch`} style={styles.legendSwatchDashed}>
          {DASH_KEYS.map((k) => (
            <View
              key={k}
              style={[
                styles.legendDash,
                { borderColor: swatch, backgroundColor: on ? swatch : 'transparent' },
              ]}
            />
          ))}
        </View>
      ) : (
        <View
          testID={`${testID}-swatch`}
          style={[
            styles.legendSwatch,
            { borderColor: swatch, backgroundColor: on ? swatch : 'transparent' },
          ]}
        />
      )}
      <Text style={[styles.legendText, { color: on ? textOn : text }]}>{label}</Text>
    </PressTarget>
  );
}

const DASH_KEYS = ['a', 'b', 'c'];

// The legend chips sit side by side, so their slop is vertical only.
const LEGEND_CHIP_HEIGHT = typography.caption.lineHeight + 2 * spacing.xs;
const legendChipSlop = slopToMinTapTarget(LEGEND_CHIP_HEIGHT);

const styles = StyleSheet.create({
  container: { flex: 1 },
  styleButton: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
  },
  legend: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm + layout.minTapTarget + spacing.sm,
    right: spacing.sm,
  },
  legendContent: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexGrow: 1,
    gap: spacing.xs,
  },
  legendSwatchDashed: {
    width: 14,
    height: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendDash: {
    width: 4,
    height: 4,
    borderRadius: layout.borderRadiusFull,
    borderWidth: stroke.one,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: LEGEND_CHIP_HEIGHT,
    borderRadius: layout.borderRadiusSm,
    borderWidth: stroke.hairline,
  },
  legendChipOff: {
    opacity: opacity.dim,
  },
  legendSwatch: {
    width: 14,
    height: 4,
    borderRadius: layout.borderRadiusFull,
    borderWidth: stroke.one,
  },
  legendText: {
    ...typography.captionBold,
  },
});
