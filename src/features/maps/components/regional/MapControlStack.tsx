/**
 * Control column for RegionalMapView: 3D, compass, locate and one layers
 * control. The layer toggles and fit-all sit in the menu the layers control
 * opens, so the column stays four controls tall however much the map holds.
 *
 * Each control is a `MapControlButton`, drawn at the map button's size and
 * lifted to the platform tap minimum through hit slop.
 */

import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, colorWithOpacity, darkColors, type MapPalette, spacing } from '@/theme';
import { MapKeyRamp, MapKeySwatch } from '../MapKey';
import { MapControlButton } from '../MapControlButton';
import {
  MapLayersButton,
  MapLayersMenu,
  layersMenuPlacement,
  useLayersMenu,
  type MapLayerRow,
} from '../MapLayersMenu';
import {
  SPORT_FAMILY_LABELS,
  sportMarkColour,
  type SportFamily,
} from '../../lib/activityCategories';
import { RECENCY_FADE } from './regionalMapLayerSpecs';
import { SECTION_LINE_DASH } from '../../lib/mapLineWidths';
import { FIT_GLYPH, LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';

/** Controls above the layers control, which the menu lines up beside. */
const CONTROLS_ABOVE_LAYERS = 3;
/** Steps in the key's recency strip, newest to a year old. */
const RECENCY_STEPS = 6;
/** Colours a section or route key runs through, enough to read as one per line. */
const LINE_KEY_COLOURS = 3;

/** The recency strip: one dot colour at each opacity the fade passes through. */
function recencyRamp(dot: string): string[] {
  return Array.from({ length: RECENCY_STEPS }, (_, i) =>
    colorWithOpacity(
      dot,
      RECENCY_FADE.newest + ((RECENCY_FADE.oldest - RECENCY_FADE.newest) * i) / (RECENCY_STEPS - 1)
    )
  );
}

/** One round control in the column. */
function ColumnButton({
  testID,
  active = false,
  disabled = false,
  expanded,
  onPress,
  accessibilityLabel,
  children,
}: {
  testID: string;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  return (
    <MapControlButton
      testID={testID}
      selected={active}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      {...(expanded === undefined ? {} : { accessibilityState: { expanded } })}
    >
      {children}
    </MapControlButton>
  );
}

interface MapControlStackProps {
  /** Top position offset (includes safe area) */
  top: number;
  /** Whether dark mode is active */
  isDark: boolean;
  /** Whether 3D mode is enabled */
  is3DMode: boolean;
  /** Whether 3D can be enabled (has route data) */
  can3D: boolean;
  /** Whether activities are visible */
  showActivities: boolean;
  /** Whether heatmap is visible */
  showHeatmap: boolean;
  /** Whether sections are visible */
  showSections: boolean;
  /** Whether routes are visible */
  showRoutes: boolean;
  /** Whether user location is active */
  userLocationActive: boolean;
  /** Whether location is currently being fetched */
  locationLoading: boolean;
  /** Number of sections (for showing sections toggle) */
  sectionCount: number;
  /** Number of routes (for showing routes toggle) */
  routeCount: number;
  /** Number of activities (for showing activities toggle) */
  activityCount: number;
  /** Animated bearing value for compass */
  bearingAnim: Animated.Value;
  /** Callback to toggle 3D mode */
  onToggle3D: () => void;
  /** Callback to reset orientation */
  onResetOrientation: () => void;
  /** Callback to get user location */
  onGetLocation: () => void;
  /** Callback to toggle activities */
  onToggleActivities: () => void;
  /** Callback to toggle heatmap (undefined = hidden) */
  onToggleHeatmap?: (() => void) | undefined;
  /** Callback to toggle sections (undefined = hidden) */
  onToggleSections?: (() => void) | undefined;
  /** Callback to toggle routes (undefined = hidden) */
  onToggleRoutes?: (() => void) | undefined;
  /** Callback to fit all activities in view */
  onFitAll: () => void;
  /** Sport categories whose dots the map draws, keyed by their colour while activities show. */
  keyCategories?: readonly SportFamily[] | undefined;
  /** The heatmap ramp as the layer draws it, faintest first, keyed while the heatmap shows. */
  heatKeyColours?: readonly string[] | undefined;
  /** The palette of the base the map draws, whose edge and line colours the section and route keys show. */
  linePalette: MapPalette;
}

export function MapControlStack({
  top,
  isDark,
  is3DMode,
  can3D,
  showActivities,
  showHeatmap,
  showSections,
  showRoutes,
  userLocationActive,
  locationLoading,
  sectionCount,
  routeCount,
  activityCount,
  bearingAnim,
  onToggle3D,
  onResetOrientation,
  onGetLocation,
  onToggleActivities,
  onToggleHeatmap,
  onToggleSections,
  onToggleRoutes,
  onFitAll,
  keyCategories = [],
  heatKeyColours = [],
  linePalette,
}: MapControlStackProps) {
  const { t } = useTranslation();
  const show3D = is3DMode && can3D;
  const palette = isDark ? darkColors : colors;

  const hasActivities = activityCount > 0;
  const sectionsToggle = sectionCount > 0 ? onToggleSections : undefined;
  const routesToggle = routeCount > 0 ? onToggleRoutes : undefined;
  const hasLayers = hasActivities || !!sectionsToggle || !!onToggleHeatmap || !!routesToggle;
  const layers = useLayersMenu(hasLayers);
  const menuOpen = layers.open;
  const recencyEnds = [t('maps.keyRecent'), t('maps.keyYearOrMore')] as const;
  const heatEnds = [t('maps.keyFewerPasses'), t('maps.keyMorePasses')] as const;

  // Any other control, and fit-all, closes the menu on the way: the athlete has
  // gone back to the map.
  const closing = (action: () => void) => () => {
    layers.close();
    action();
  };

  const rows: MapLayerRow[] = [];
  if (hasActivities) {
    rows.push({
      testID: 'map-toggle-activities',
      icon: 'map-marker-multiple',
      label: t('maps.layerActivities'),
      checked: showActivities,
      onPress: onToggleActivities,
      layerKey: showActivities ? (
        <>
          {keyCategories.length > 0 ? (
            <View testID="map-key-categories" style={styles.menuKeyLine}>
              {keyCategories.map((category) => (
                <MapKeySwatch
                  key={category}
                  testID={`map-key-category-${category}`}
                  swatch={sportMarkColour(category, isDark)}
                  shape="dot"
                  label={t(SPORT_FAMILY_LABELS[category])}
                  isDark={isDark}
                />
              ))}
            </View>
          ) : null}
          <MapKeyRamp
            testID="map-key-recency"
            ramp={recencyRamp(palette.textPrimary)}
            label={t('maps.keyRecencyAxis')}
            ends={recencyEnds}
            stretch
            isDark={isDark}
          />
        </>
      ) : undefined,
      keyHint: [
        ...keyCategories.map((category) => t(SPORT_FAMILY_LABELS[category])),
        ...recencyEnds,
      ].join(', '),
    });
  }
  if (sectionsToggle) {
    rows.push({
      testID: 'map-toggle-sections',
      icon: 'road-variant',
      label: t('maps.layerSections'),
      checked: showSections,
      onPress: sectionsToggle,
      layerKey: showSections ? (
        <MapKeySwatch
          testID="map-key-sections"
          stretch
          swatch={linePalette.layer.sections.slice(0, LINE_KEY_COLOURS)}
          dash={SECTION_LINE_DASH}
          edge={linePalette.edge}
        />
      ) : undefined,
    });
  }
  if (onToggleHeatmap) {
    rows.push({
      testID: 'map-toggle-heatmap',
      icon: 'fire',
      label: t('maps.layerHeatmap'),
      checked: showHeatmap,
      onPress: onToggleHeatmap,
      layerKey:
        showHeatmap && heatKeyColours.length > 0 ? (
          <MapKeyRamp
            testID="map-key-heat"
            ramp={heatKeyColours}
            label={t('maps.keyHeatAxis')}
            ends={heatEnds}
            stretch
            isDark={isDark}
          />
        ) : undefined,
      keyHint: heatEnds.join(', '),
    });
  }
  if (routesToggle) {
    rows.push({
      testID: 'map-toggle-routes',
      icon: 'map-marker-path',
      label: t('maps.layerRoutes'),
      checked: showRoutes,
      onPress: routesToggle,
      layerKey: showRoutes ? (
        <MapKeySwatch
          testID="map-key-routes"
          stretch
          swatch={linePalette.layer.routes.slice(0, LINE_KEY_COLOURS)}
          edge={linePalette.edge}
        />
      ) : undefined,
    });
  }
  const actions: MapLayerRow[] = hasActivities
    ? [
        {
          testID: 'map-fit-all',
          icon: FIT_GLYPH,
          label: t('maps.fitAll'),
          onPress: closing(onFitAll),
        },
      ]
    : [];

  return (
    <>
      <View style={[styles.controlStack, { top }]}>
        <ColumnButton
          testID="map-toggle-3d"
          active={show3D}
          disabled={!can3D}
          onPress={closing(onToggle3D)}
          accessibilityLabel={show3D ? t('maps.disable3D') : t('maps.enable3D')}
        >
          <MapControlButton.Glyph name="terrain" />
        </ColumnButton>

        <ColumnButton
          testID="map-compass"
          onPress={closing(onResetOrientation)}
          accessibilityLabel={t('maps.resetOrientation')}
        >
          <MapControlButton.Compass rotation={bearingAnim} />
        </ColumnButton>

        <ColumnButton
          testID="map-location"
          active={userLocationActive}
          disabled={locationLoading}
          onPress={closing(onGetLocation)}
          accessibilityLabel={t('maps.goToLocation')}
        >
          {locationLoading ? (
            <MapControlButton.Spinner />
          ) : (
            <MapControlButton.Glyph name={LOCATE_GLYPH} />
          )}
        </ColumnButton>

        {hasLayers ? (
          <MapLayersButton testID="map-layers" open={menuOpen} onPress={layers.toggle} />
        ) : null}
      </View>

      {menuOpen ? (
        <MapLayersMenu
          testID="map-layers-menu"
          backdropTestID="map-layers-backdrop"
          rows={rows}
          actions={actions}
          isDark={isDark}
          onClose={layers.close}
          {...layersMenuPlacement(top, CONTROLS_ABOVE_LAYERS, spacing.md)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  controlStack: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.sm,
  },
  menuKeyLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xxs,
  },
});
