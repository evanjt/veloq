import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useMetricSystem, useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ACTIVITY_CATEGORIES } from '@/shared/activity/sportCategories';
import { useMapPreferences } from '../stores/MapPreferencesContext';
import { clearTerrainPreviews, SMART_3D_MIN_RELIEF_M, type MapStyleType } from '@/features/maps';
import { formatElevation } from '@/shared/format/format';
import { MapStylePreviewPicker } from './MapStylePreviewPicker';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { Row } from '@/shared/ui/Row';
import { RowDivider } from '@/shared/ui/RowGroup';
import { composeAccessibilityLabel, pressable, pressRipple } from '@/shared/ui';
import { HeatmapRow } from './HeatmapRow';
import { groupStyleState, groupTerrainState } from '../lib/mapStyleGroupState';
import { settingsStyles } from './settingsStyles';
import type { ActivityType, Terrain3DMode } from '@/types';

export const MAP_ACTIVITY_GROUPS: {
  key: string;
  labelKey: string;
  types: ActivityType[];
}[] = Object.entries(ACTIVITY_CATEGORIES).map(([key, config]) => ({
  key,
  labelKey: config.label,
  types: config.types as ActivityType[],
}));

const MAP_STYLES: MapStyleType[] = ['light', 'dark', 'satellite'];
const MAP_STYLES_WITH_DEFAULT = ['default', ...MAP_STYLES] as const;
const TERRAIN_MODES: Terrain3DMode[] = ['off', 'smart', 'always'];

const STYLE_LABELS: Record<string, string> = {
  default: 'settings.default',
  light: 'settings.light',
  dark: 'settings.dark',
  satellite: 'settings.satellite',
};

const TERRAIN_LABELS: Record<string, string> = {
  off: 'settings.terrain3DOff',
  smart: 'settings.terrain3DSmart',
  always: 'settings.terrain3DAlways',
};

export function MapsSection() {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const isMetric = useMetricSystem();
  const { t } = useTranslation();
  const {
    preferences: mapPreferences,
    setDefaultStyle,
    setGlobalMapStyle,
    setActivityGroupStyle,
    setTerrain3DMode,
    setTerrain3DModeGroup,
  } = useMapPreferences();

  const handleDefaultMapStyleChange = async (value: string) => {
    await setDefaultStyle(value as MapStyleType);
    await clearTerrainPreviews();
  };

  const cycleGlobalMapStyle = async () => {
    const current = mapPreferences.globalMapStyle ?? 'default';
    const idx = MAP_STYLES_WITH_DEFAULT.indexOf(current);
    const next = MAP_STYLES_WITH_DEFAULT[(idx + 1) % MAP_STYLES_WITH_DEFAULT.length];
    await setGlobalMapStyle(next === 'default' ? null : next);
    await clearTerrainPreviews();
  };

  const cycleActivityGroupStyle = async (types: ActivityType[]) => {
    const current = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
    const idx = MAP_STYLES_WITH_DEFAULT.indexOf(
      current as (typeof MAP_STYLES_WITH_DEFAULT)[number]
    );
    const next = MAP_STYLES_WITH_DEFAULT[(idx + 1) % MAP_STYLES_WITH_DEFAULT.length];
    await setActivityGroupStyle(types, next === 'default' ? null : (next as MapStyleType));
    await clearTerrainPreviews();
  };

  const cycleTerrain3DMode = async () => {
    const idx = TERRAIN_MODES.indexOf(mapPreferences.terrain3DMode);
    await setTerrain3DMode(null, TERRAIN_MODES[(idx + 1) % TERRAIN_MODES.length]);
    await clearTerrainPreviews();
  };

  const cycleTerrain3DGroup = async (types: ActivityType[]) => {
    const current = mapPreferences.terrain3DModeByType[types[0]] ?? mapPreferences.terrain3DMode;
    const idx = TERRAIN_MODES.indexOf(current);
    await setTerrain3DModeGroup(types, TERRAIN_MODES[(idx + 1) % TERRAIN_MODES.length]);
    await clearTerrainPreviews();
  };

  const terrain3DLabel =
    mapPreferences.terrain3DMode === 'off'
      ? t('settings.terrain3DOff', { defaultValue: 'Off' })
      : mapPreferences.terrain3DMode === 'smart'
        ? t('settings.terrain3DSmart', { defaultValue: 'Smart' })
        : t('settings.terrain3DAlways', { defaultValue: 'Always' });

  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const pillBg = isDark ? darkColors.surfaceElevated : colors.background;
  const exploreStyleKey = STYLE_LABELS[mapPreferences.globalMapStyle ?? 'default'];

  const mapsContent = (
    <>
      {/* Default style + 3D terrain toggle */}
      <View style={styles.styleHeaderRow}>
        <Text style={[styles.mapStyleLabel, isDark && settingsStyles.textLight]}>
          {t('settings.defaultStyle')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.terrain3D')}: ${terrain3DLabel}`}
          style={pressable(styles.terrain3DBadge)}
          hitSlop={pillSlop}
          onPress={cycleTerrain3DMode}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons
            name="image-filter-hdr"
            size={iconSize.sm}
            color={mapPreferences.terrain3DMode === 'off' ? palette.textSecondary : palette.primary}
          />
          <Text
            style={[
              styles.terrain3DBadgeText,
              mapPreferences.terrain3DMode !== 'off' && styles.terrain3DBadgeActive,
              mapPreferences.terrain3DMode !== 'off' && isDark && { color: darkColors.actionLink },
            ]}
          >
            {t('settings.terrain3DMode', { mode: terrain3DLabel })}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.terrainHint, isDark && settingsStyles.textSecondary]}>
        {t('settings.terrain3DSmartHint', {
          height: formatElevation(SMART_3D_MIN_RELIEF_M, isMetric),
        })}
      </Text>
      <MapStylePreviewPicker
        value={mapPreferences.defaultStyle}
        onValueChange={handleDefaultMapStyleChange}
      />

      {/* The heatmap is something the map draws, so it lives here. */}
      <HeatmapRow />

      {/* Per-activity overrides */}
      <RowDivider />
      <Row>
        <MaterialCommunityIcons name="tune-variant" size={iconSize.md} color={palette.primary} />
        <Text style={[styles.actionText, isDark && settingsStyles.textLight]}>
          {t('settings.customiseByActivity')}
        </Text>
      </Row>

      <View style={styles.overridesContainer}>
        {/* Explore Map row */}
        <View style={styles.overrideRow}>
          <MaterialCommunityIcons name="map-outline" size={iconSize.md} color={palette.primary} />
          <Text style={[styles.overrideLabel, isDark && settingsStyles.textLight]}>
            {t('settings.exploreMapStyle')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('settings.exploreMapStyle')}: ${t(exploreStyleKey as 'settings.default')}`}
            style={pressable([styles.pill, { backgroundColor: pillBg }])}
            hitSlop={pillSlop}
            testID="map-style-pill-explore"
            onPress={cycleGlobalMapStyle}
            android_ripple={pressRipple}
          >
            <Text style={[styles.pillText, { color: mutedColor }]}>
              {t(exploreStyleKey as 'settings.default')}
            </Text>
          </Pressable>
        </View>

        <View style={styles.overrideDividerGap}>
          <RowDivider inset="none" />
        </View>

        {/* Per-activity-group rows */}
        {MAP_ACTIVITY_GROUPS.map(({ key, labelKey, types }) => {
          const style = groupStyleState(types, mapPreferences.activityTypeStyles);
          const terrain = groupTerrainState(
            types,
            mapPreferences.terrain3DModeByType,
            mapPreferences.terrain3DMode
          );
          const styleKey = style.mixed
            ? 'settings.mixed'
            : (STYLE_LABELS[style.value] ?? 'settings.default');
          const terrainKey = terrain.mixed
            ? 'settings.mixed'
            : (TERRAIN_LABELS[terrain.value] ?? 'settings.terrain3DSmart');
          const sportName = t(labelKey as 'sportFamilies.ride');
          const terrainText = t('settings.terrain3DMode', {
            mode: t(terrainKey as 'settings.terrain3DSmart', {
              defaultValue: 'Smart',
            }),
          });

          return (
            <View key={key} style={styles.overrideRow}>
              <Text style={[styles.overrideLabel, isDark && settingsStyles.textLight]}>
                {t(labelKey as 'sportFamilies.ride')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t(labelKey as 'sportFamilies.ride')}: ${t(styleKey as 'settings.default')}`}
                style={pressable([styles.pill, { backgroundColor: pillBg }])}
                hitSlop={pillSlop}
                testID={`map-style-pill-${key}`}
                onPress={() => cycleActivityGroupStyle(types)}
                android_ripple={pressRipple}
              >
                <Text style={[styles.pillText, { color: mutedColor }]}>
                  {t(styleKey as 'settings.default')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={composeAccessibilityLabel(sportName, terrainText)}
                accessibilityHint={t('a11y.cycleHint')}
                style={pressable([styles.pill, { backgroundColor: pillBg }])}
                hitSlop={pillSlop}
                testID={`map-terrain-pill-${key}`}
                onPress={() => cycleTerrain3DGroup(types)}
                android_ripple={pressRipple}
              >
                <Text style={[styles.pillText, { color: mutedColor }]}>{terrainText}</Text>
              </Pressable>
            </View>
          );
        })}

        <Text style={[styles.hintText, isDark && settingsStyles.textSecondary]}>
          {t('settings.defaultMapHint')}
        </Text>
      </View>
    </>
  );

  // The screen's large title already says Maps, so the one card carries no label.
  return (
    <View
      style={[
        settingsStyles.sectionCard,
        isDark && settingsStyles.sectionCardDark,
        styles.untitledCard,
      ]}
    >
      {mapsContent}
    </View>
  );
}

// A caption line inside the padding of the terrain badge and the style pills.
const PILL_HEIGHT = typography.caption.lineHeight + 2 * spacing.xs;
const pillSlop = slopToMinTapTarget(PILL_HEIGHT);

const styles = StyleSheet.create({
  // The gap a section label would have left above the card.
  untitledCard: {
    marginTop: spacing.lg,
  },
  styleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
  },
  terrain3DBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: PILL_HEIGHT,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.light,
  },
  terrain3DBadgeText: {
    ...typography.badge,
    color: colors.textSecondary,
  },
  terrain3DBadgeActive: {
    color: colors.actionLink,
  },
  actionText: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  overridesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  overrideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  overrideLabel: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
    flex: 1,
    flexShrink: 1,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: PILL_HEIGHT,
    borderRadius: layout.borderRadiusSm,
  },
  pillText: {
    ...typography.caption,
    fontSize: typography.caption.fontSize,
  },
  overrideDividerGap: {
    paddingVertical: spacing.xs,
  },
  terrainHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  hintText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});
