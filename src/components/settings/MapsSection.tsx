import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/providers';
import { type MapStyleType } from '@/features/maps/components';
import { MapStylePreviewPicker } from './MapStylePreviewPicker';
import { clearTerrainPreviews } from '@/features/maps/lib/storage/terrainPreviewCache';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { settingsStyles } from './settingsStyles';
import type { ActivityType, Terrain3DMode } from '@/types';

type FilterLabelKey =
  | 'filters.cycling'
  | 'filters.running'
  | 'filters.hiking'
  | 'filters.walking'
  | 'filters.swimming'
  | 'filters.snowSports'
  | 'filters.waterSports'
  | 'filters.climbing'
  | 'filters.racketSports'
  | 'filters.other';

const MAP_ACTIVITY_GROUPS: {
  key: string;
  labelKey: FilterLabelKey;
  types: ActivityType[];
}[] = [
  { key: 'cycling', labelKey: 'filters.cycling', types: ['Ride', 'VirtualRide'] },
  { key: 'running', labelKey: 'filters.running', types: ['Run', 'TrailRun', 'VirtualRun'] },
  { key: 'hiking', labelKey: 'filters.hiking', types: ['Hike'] },
  { key: 'walking', labelKey: 'filters.walking', types: ['Walk'] },
  { key: 'swimming', labelKey: 'filters.swimming', types: ['Swim', 'OpenWaterSwim'] },
  {
    key: 'snow',
    labelKey: 'filters.snowSports',
    types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard', 'Snowshoe'],
  },
  { key: 'water', labelKey: 'filters.waterSports', types: ['Rowing', 'Kayaking', 'Canoeing'] },
  { key: 'climbing', labelKey: 'filters.climbing', types: ['RockClimbing'] },
  { key: 'racket', labelKey: 'filters.racketSports', types: ['Tennis'] },
  {
    key: 'other',
    labelKey: 'filters.other',
    types: ['Workout', 'WeightTraining', 'Yoga', 'Other'],
  },
];

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

interface MapsSectionProps {
  embedded?: boolean;
}

export function MapsSection({ embedded }: MapsSectionProps = {}) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const showOverrides = true;
  const {
    preferences: mapPreferences,
    setDefaultStyle,
    setGlobalMapStyle,
    getGlobalMapStyle,
    setActivityGroupStyle,
    setTerrain3DMode,
    setTerrain3DModeGroup,
    getTerrain3DMode,
  } = useMapPreferences();

  useEffect(() => {
    const byType = mapPreferences.terrain3DModeByType;
    for (const group of MAP_ACTIVITY_GROUPS) {
      const lead = byType[group.types[0]];
      if (lead === undefined) continue;
      const needsFix = group.types.some((tp) => byType[tp] !== lead);
      if (needsFix) {
        setTerrain3DModeGroup(group.types, lead);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDefaultMapStyleChange = async (value: string) => {
    await setDefaultStyle(value as MapStyleType);
    await clearTerrainPreviews();
  };

  const cycleGlobalMapStyle = async () => {
    const current = getGlobalMapStyle();
    const idx = MAP_STYLES.indexOf(current);
    const next = MAP_STYLES[(idx + 1) % MAP_STYLES.length];
    await setGlobalMapStyle(next);
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
    const current = getTerrain3DMode(types[0]);
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
  const exploreStyle = getGlobalMapStyle();

  const mapsContent = (
    <>
      {/* Default style + 3D terrain toggle */}
      <View style={styles.styleHeaderRow}>
        <Text style={[styles.mapStyleLabel, isDark && settingsStyles.textLight]}>
          {t('settings.defaultStyle')}
        </Text>
        <TouchableOpacity
          style={styles.terrain3DBadge}
          onPress={cycleTerrain3DMode}
          activeOpacity={0.6}
        >
          <MaterialCommunityIcons
            name="image-filter-hdr"
            size={14}
            color={mapPreferences.terrain3DMode === 'off' ? colors.textSecondary : colors.primary}
          />
          <Text
            style={[
              styles.terrain3DBadgeText,
              mapPreferences.terrain3DMode !== 'off' && styles.terrain3DBadgeActive,
            ]}
          >
            3D: {terrain3DLabel}
          </Text>
        </TouchableOpacity>
      </View>
      <MapStylePreviewPicker
        value={mapPreferences.defaultStyle}
        onValueChange={handleDefaultMapStyleChange}
      />

      {/* Per-activity overrides */}
      <View style={[styles.actionRow, styles.actionRowBorder]}>
        <MaterialCommunityIcons name="tune-variant" size={22} color={colors.primary} />
        <Text style={[styles.actionText, isDark && settingsStyles.textLight]}>
          {t('settings.customiseByActivity')}
        </Text>
      </View>

      <View style={styles.overridesContainer}>
        {/* Explore Map row */}
        <View style={styles.overrideRow}>
          <MaterialCommunityIcons name="map-outline" size={16} color={colors.primary} />
          <Text
            style={[styles.overrideLabel, isDark && settingsStyles.textLight]}
            numberOfLines={1}
          >
            {t('settings.exploreMapStyle')}
          </Text>
          <TouchableOpacity
            style={[styles.pill, { backgroundColor: pillBg }]}
            onPress={cycleGlobalMapStyle}
            activeOpacity={0.6}
          >
            <Text style={[styles.pillText, { color: mutedColor }]}>
              {t((STYLE_LABELS[exploreStyle] ?? 'settings.light') as 'settings.light')}
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.overrideDivider,
            { backgroundColor: isDark ? darkColors.border : colors.border },
          ]}
        />

        {/* Per-activity-group rows */}
        {MAP_ACTIVITY_GROUPS.map(({ key, labelKey, types }) => {
          const currentStyle = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
          const terrain3D = getTerrain3DMode(types[0]);
          const styleKey = STYLE_LABELS[currentStyle] ?? 'settings.default';
          const terrainKey = TERRAIN_LABELS[terrain3D] ?? 'settings.terrain3DSmart';

          return (
            <View key={key} style={styles.overrideRow}>
              <Text
                style={[styles.overrideLabel, isDark && settingsStyles.textLight]}
                numberOfLines={1}
              >
                {t(labelKey)}
              </Text>
              <TouchableOpacity
                style={[styles.pill, { backgroundColor: pillBg }]}
                onPress={() => cycleActivityGroupStyle(types)}
                activeOpacity={0.6}
              >
                <Text style={[styles.pillText, { color: mutedColor }]}>
                  {t(styleKey as 'settings.default')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pill, { backgroundColor: pillBg }]}
                onPress={() => cycleTerrain3DGroup(types)}
                activeOpacity={0.6}
              >
                <Text style={[styles.pillText, { color: mutedColor }]}>
                  3D: {t(terrainKey as 'settings.terrain3DSmart', { defaultValue: 'Smart' })}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={[styles.hintText, isDark && settingsStyles.textMuted]}>
          {t('settings.defaultMapHint')}
        </Text>
      </View>
    </>
  );

  if (embedded) return mapsContent;

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.maps').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {mapsContent}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  styleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    ...typography.bodySmall,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  terrain3DBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.light,
  },
  terrain3DBadgeText: {
    ...typography.badge,
    color: colors.textSecondary,
  },
  terrain3DBadgeActive: {
    color: colors.primary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    ...typography.bodySmall,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
    flexShrink: 1,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: layout.borderRadiusSm,
  },
  pillText: {
    ...typography.caption,
    fontSize: 12,
  },
  overrideDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  hintText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
});
