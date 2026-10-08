/**
 * Control column for RegionalMapView: 3D, compass, locate and one layers
 * control. The layer toggles and fit-all sit in the menu the layers control
 * opens, so the column stays four controls tall however much the map holds.
 *
 * Each control is drawn at the icon-button size and reaches the platform tap
 * minimum through hit slop, as `IconButton` does everywhere else.
 */

import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Text, Animated, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/shared/ui/IconButton';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import {
  colors,
  darkColors,
  spacing,
  shadows,
  layout,
  controlHeight,
  colorWithOpacity,
  ink,
  typography,
} from '@/theme';
import { CompassArrow } from '@/shared/ui';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The glyph inside a column control. */
const COLUMN_ICON_SIZE = 20;
/** The glyph beside a menu row's label. */
const MENU_ICON_SIZE = 18;
/** Controls above the layers control, which the menu lines up beside. */
const CONTROLS_ABOVE_LAYERS = 3;

/** One round control in the column, on a disc that carries the map shadow. */
function ColumnButton({
  testID,
  isDark,
  active = false,
  disabled = false,
  expanded,
  onPress,
  accessibilityLabel,
  children,
}: {
  testID: string;
  isDark: boolean;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.columnDisc, isDark && styles.surfaceDark]}>
      <IconButton
        testID={testID}
        variant="ghost"
        style={[styles.columnButton, active && styles.columnButtonActive]}
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        {...(expanded === undefined ? {} : { accessibilityState: { expanded } })}
      >
        {children}
      </IconButton>
    </View>
  );
}

/** One row of the layers menu: a toggle when `checked` is given, else an action. */
function MenuRow({
  testID,
  icon,
  label,
  checked,
  isDark,
  onPress,
}: {
  testID: string;
  icon: IconName;
  label: string;
  checked?: boolean;
  isDark: boolean;
  onPress: () => void;
}) {
  const palette = isDark ? darkColors : colors;
  const isToggle = checked !== undefined;
  return (
    <Pressable
      testID={testID}
      style={pressable(styles.menuRow)}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole={isToggle ? 'checkbox' : 'button'}
      accessibilityState={isToggle ? { checked } : undefined}
      android_ripple={pressRipple}
    >
      <MaterialCommunityIcons
        name={icon}
        size={MENU_ICON_SIZE}
        color={checked ? palette.primary : palette.textSecondary}
      />
      <Text style={[styles.menuLabel, { color: palette.textPrimary }]}>{label}</Text>
      {isToggle && (
        <MaterialCommunityIcons
          name="check"
          size={MENU_ICON_SIZE}
          color={checked ? palette.primary : 'transparent'}
        />
      )}
    </Pressable>
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
}: MapControlStackProps) {
  const { t } = useTranslation();
  const [layersOpen, setLayersOpen] = useState(false);
  const show3D = is3DMode && can3D;
  const iconColor = isDark ? colors.textOnDark : colors.textSecondary;

  const hasActivities = activityCount > 0;
  const sectionsToggle = sectionCount > 0 ? onToggleSections : undefined;
  const routesToggle = routeCount > 0 ? onToggleRoutes : undefined;
  const hasLayers = hasActivities || !!sectionsToggle || !!onToggleHeatmap || !!routesToggle;
  const menuOpen = layersOpen && hasLayers;

  // Any other control, and fit-all, closes the menu on the way: the athlete has
  // gone back to the map.
  const closing = (action: () => void) => () => {
    setLayersOpen(false);
    action();
  };

  return (
    <>
      {menuOpen && (
        // press-feedback: none, an invisible scrim over the map that only closes the menu
        <Pressable
          testID="map-layers-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={() => setLayersOpen(false)}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        />
      )}
      <View style={[styles.controlStack, { top }]}>
        <ColumnButton
          testID="map-toggle-3d"
          isDark={isDark}
          active={show3D}
          disabled={!can3D}
          onPress={closing(onToggle3D)}
          accessibilityLabel={show3D ? t('maps.disable3D') : t('maps.enable3D')}
        >
          <MaterialCommunityIcons
            name="terrain"
            size={COLUMN_ICON_SIZE}
            color={show3D ? colors.textOnDark : iconColor}
          />
        </ColumnButton>

        <ColumnButton
          testID="map-compass"
          isDark={isDark}
          onPress={closing(onResetOrientation)}
          accessibilityLabel={t('maps.resetOrientation')}
        >
          <CompassArrow
            size={COLUMN_ICON_SIZE}
            rotation={bearingAnim}
            northColor={colors.error}
            southColor={iconColor}
          />
        </ColumnButton>

        <ColumnButton
          testID="map-location"
          isDark={isDark}
          active={userLocationActive}
          disabled={locationLoading}
          onPress={closing(onGetLocation)}
          accessibilityLabel={t('maps.goToLocation')}
        >
          {locationLoading ? (
            <ActivityIndicator size="small" color={iconColor} />
          ) : (
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={COLUMN_ICON_SIZE}
              color={userLocationActive ? colors.textOnDark : iconColor}
            />
          )}
        </ColumnButton>

        {hasLayers && (
          <ColumnButton
            testID="map-layers"
            isDark={isDark}
            active={menuOpen}
            expanded={menuOpen}
            onPress={() => setLayersOpen((open) => !open)}
            accessibilityLabel={t('maps.layers')}
          >
            <MaterialCommunityIcons
              name="layers-outline"
              size={COLUMN_ICON_SIZE}
              color={menuOpen ? colors.textOnDark : iconColor}
            />
          </ColumnButton>
        )}
      </View>

      {menuOpen && (
        <View
          testID="map-layers-menu"
          style={[
            styles.menu,
            isDark && styles.surfaceDark,
            { top: top + CONTROLS_ABOVE_LAYERS * (controlHeight.button + spacing.sm) },
          ]}
        >
          {hasActivities && (
            <MenuRow
              testID="map-toggle-activities"
              icon="map-marker-multiple"
              label={t('maps.layerActivities')}
              checked={showActivities}
              isDark={isDark}
              onPress={onToggleActivities}
            />
          )}
          {sectionsToggle && (
            <MenuRow
              testID="map-toggle-sections"
              icon="road-variant"
              label={t('maps.layerSections')}
              checked={showSections}
              isDark={isDark}
              onPress={sectionsToggle}
            />
          )}
          {onToggleHeatmap && (
            <MenuRow
              testID="map-toggle-heatmap"
              icon="fire"
              label={t('maps.layerHeatmap')}
              checked={showHeatmap}
              isDark={isDark}
              onPress={onToggleHeatmap}
            />
          )}
          {routesToggle && (
            <MenuRow
              testID="map-toggle-routes"
              icon="map-marker-path"
              label={t('maps.layerRoutes')}
              checked={showRoutes}
              isDark={isDark}
              onPress={routesToggle}
            />
          )}
          {hasActivities && (
            <>
              <View style={[styles.menuDivider, isDark && styles.menuDividerDark]} />
              <MenuRow
                testID="map-fit-all"
                icon="fit-to-screen-outline"
                label={t('maps.fitAll')}
                isDark={isDark}
                onPress={closing(onFitAll)}
              />
            </>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  controlStack: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.sm,
  },
  columnDisc: {
    width: controlHeight.button,
    height: controlHeight.button,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    ...shadows.mapOverlay,
  },
  surfaceDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  columnButton: {
    width: controlHeight.button,
    height: controlHeight.button,
    borderRadius: layout.borderRadiusFull,
  },
  columnButtonActive: {
    backgroundColor: colors.primary,
  },
  menu: {
    position: 'absolute',
    right: spacing.md + controlHeight.button + spacing.sm,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    paddingVertical: spacing.xs,
    ...shadows.mapOverlay,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smPlus,
    minHeight: layout.minTapTarget,
    paddingHorizontal: spacing.md,
  },
  menuLabel: {
    ...typography.bodySmall,
    flexShrink: 1,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colorWithOpacity(ink.black, 0.1),
    marginVertical: spacing.xs,
  },
  menuDividerDark: {
    backgroundColor: colorWithOpacity(ink.white, 0.1),
  },
});
