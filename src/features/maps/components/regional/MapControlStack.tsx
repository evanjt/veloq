/**
 * Control column for RegionalMapView: 3D, compass, locate and one layers
 * control. The layer toggles and fit-all sit in the menu the layers control
 * opens, so the column stays four controls tall however much the map holds.
 *
 * Each control is a `MapControlButton`, drawn at the map button's size and
 * lifted to the platform tap minimum through hit slop.
 */

import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Text, Animated } from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RowDivider } from '@/shared/ui/RowGroup';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  raised,
  type MapPalette,
  spacing,
  typography,
} from '@/theme';
import { Icon } from '@/shared/ui/Icon';
import { MenuCheck } from '@/shared/ui/ContextMenu';
import { useBackDismiss } from '@/shared/app/useBackDismiss';
import { MapKeyRamp, MapKeySwatch } from '../MapKey';
import { MAP_CONTROL_SIZE, MapControlButton } from '../MapControlButton';
import {
  SPORT_FAMILY_LABELS,
  sportMarkColour,
  type SportFamily,
} from '../../lib/activityCategories';
import { RECENCY_FADE } from './regionalMapLayerSpecs';
import { SECTION_LINE_DASH } from '../../lib/mapLineWidths';
import { FIT_GLYPH, LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';
import { PressTarget } from '@/shared/ui/PressTarget';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The glyph inside a column control. */
/** The glyph beside a menu row's label. */
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

/**
 * One row of the layers menu: a toggle when `checked` is given, else an action.
 * A layer's key sits under its label inside the row, so the row and its key are
 * one tap target, and a screen reader hears the layer's name with the key's
 * text as the hint.
 */
function MenuRow({
  testID,
  icon,
  label,
  checked,
  isDark,
  onPress,
  layerKey,
  keyHint,
}: {
  testID: string;
  icon: IconName;
  label: string;
  checked?: boolean;
  isDark: boolean;
  onPress: () => void;
  layerKey?: React.ReactNode;
  keyHint?: string | undefined;
}) {
  const palette = isDark ? darkColors : colors;
  const isToggle = checked !== undefined;
  return (
    <PressTarget
      testID={testID}
      style={styles.menuRow}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole={isToggle ? 'checkbox' : 'button'}
      accessibilityState={isToggle ? { checked } : undefined}
      accessibilityHint={layerKey ? keyHint : undefined}
    >
      <Icon
        name={icon}
        size={iconSize.md}
        color={checked ? palette.actionPrimary : palette.textSecondary}
      />
      <View style={styles.menuLabelColumn}>
        <Text style={[styles.menuLabel, { color: palette.textPrimary }]}>{label}</Text>
        {layerKey}
      </View>
      {checked !== undefined ? <MenuCheck checked={checked} color={palette.actionPrimary} /> : null}
    </PressTarget>
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
  const [layersOpen, setLayersOpen] = useState(false);
  const show3D = is3DMode && can3D;
  const palette = isDark ? darkColors : colors;

  const hasActivities = activityCount > 0;
  const sectionsToggle = sectionCount > 0 ? onToggleSections : undefined;
  const routesToggle = routeCount > 0 ? onToggleRoutes : undefined;
  const hasLayers = hasActivities || !!sectionsToggle || !!onToggleHeatmap || !!routesToggle;
  const menuOpen = layersOpen && hasLayers;
  const recencyEnds = [t('maps.keyRecent'), t('maps.keyYearOrMore')] as const;
  const heatEnds = [t('maps.keyFewerPasses'), t('maps.keyMorePasses')] as const;
  useBackDismiss(menuOpen, () => setLayersOpen(false));

  // Any other control, and fit-all, closes the menu on the way: the athlete has
  // gone back to the map.
  const closing = (action: () => void) => () => {
    setLayersOpen(false);
    action();
  };

  return (
    <>
      {menuOpen ? (
        // press-feedback: none, an invisible scrim over the map that only closes the menu
        <Pressable
          focusable={false}
          testID="map-layers-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={() => setLayersOpen(false)}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        />
      ) : null}
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
          <ColumnButton
            testID="map-layers"
            active={menuOpen}
            expanded={menuOpen}
            onPress={() => setLayersOpen((open) => !open)}
            accessibilityLabel={t('maps.layers')}
          >
            <MapControlButton.Glyph name="layers-outline" />
          </ColumnButton>
        ) : null}
      </View>

      {menuOpen ? (
        <View
          testID="map-layers-menu"
          style={[
            styles.menu,
            raised('mapOverlay', isDark),
            isDark && styles.surfaceDark,
            { top: top + CONTROLS_ABOVE_LAYERS * (MAP_CONTROL_SIZE + spacing.sm) },
          ]}
        >
          {hasActivities ? (
            <MenuRow
              testID="map-toggle-activities"
              icon="map-marker-multiple"
              label={t('maps.layerActivities')}
              checked={showActivities}
              isDark={isDark}
              onPress={onToggleActivities}
              layerKey={
                showActivities ? (
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
                ) : undefined
              }
              keyHint={[
                ...keyCategories.map((category) => t(SPORT_FAMILY_LABELS[category])),
                ...recencyEnds,
              ].join(', ')}
            />
          ) : null}
          {sectionsToggle ? (
            <MenuRow
              testID="map-toggle-sections"
              icon="road-variant"
              label={t('maps.layerSections')}
              checked={showSections}
              isDark={isDark}
              onPress={sectionsToggle}
              layerKey={
                showSections ? (
                  <MapKeySwatch
                    testID="map-key-sections"
                    stretch
                    swatch={linePalette.layer.sections.slice(0, LINE_KEY_COLOURS)}
                    dash={SECTION_LINE_DASH}
                    edge={linePalette.edge}
                  />
                ) : undefined
              }
            />
          ) : null}
          {onToggleHeatmap ? (
            <MenuRow
              testID="map-toggle-heatmap"
              icon="fire"
              label={t('maps.layerHeatmap')}
              checked={showHeatmap}
              isDark={isDark}
              onPress={onToggleHeatmap}
              layerKey={
                showHeatmap && heatKeyColours.length > 0 ? (
                  <MapKeyRamp
                    testID="map-key-heat"
                    ramp={heatKeyColours}
                    label={t('maps.keyHeatAxis')}
                    ends={heatEnds}
                    stretch
                    isDark={isDark}
                  />
                ) : undefined
              }
              keyHint={heatEnds.join(', ')}
            />
          ) : null}
          {routesToggle ? (
            <MenuRow
              testID="map-toggle-routes"
              icon="map-marker-path"
              label={t('maps.layerRoutes')}
              checked={showRoutes}
              isDark={isDark}
              onPress={routesToggle}
              layerKey={
                showRoutes ? (
                  <MapKeySwatch
                    testID="map-key-routes"
                    stretch
                    swatch={linePalette.layer.routes.slice(0, LINE_KEY_COLOURS)}
                    edge={linePalette.edge}
                  />
                ) : undefined
              }
            />
          ) : null}
          {hasActivities ? (
            <>
              <View style={styles.menuDividerGap}>
                <RowDivider inset="none" />
              </View>
              <MenuRow
                testID="map-fit-all"
                icon={FIT_GLYPH}
                label={t('maps.fitAll')}
                isDark={isDark}
                onPress={closing(onFitAll)}
              />
            </>
          ) : null}
        </View>
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
  surfaceDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  menu: {
    position: 'absolute',
    width: layout.mapLayersMenuWidth,
    right: spacing.md + MAP_CONTROL_SIZE + spacing.sm,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    paddingVertical: spacing.xs,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smPlus,
    minHeight: layout.minTapTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  menuLabelColumn: {
    flex: 1,
    gap: spacing.xxs,
  },
  menuKeyLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xxs,
  },
  menuLabel: {
    ...typography.bodySmall,
    flexShrink: 1,
  },
  menuDividerGap: {
    paddingVertical: spacing.xs,
  },
});
