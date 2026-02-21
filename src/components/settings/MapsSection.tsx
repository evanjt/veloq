import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/providers';
import { type MapStyleType } from '@/components/maps';
import { MapStylePreviewPicker } from './MapStylePreviewPicker';
import {
  clearTerrainPreviews,
  getTerrainPreviewCacheSize,
} from '@/lib/storage/terrainPreviewCache';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { ActivityType } from '@/types';

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
  {
    key: 'cycling',
    labelKey: 'filters.cycling',
    types: ['Ride', 'VirtualRide'],
  },
  {
    key: 'running',
    labelKey: 'filters.running',
    types: ['Run', 'TrailRun', 'VirtualRun'],
  },
  { key: 'hiking', labelKey: 'filters.hiking', types: ['Hike'] },
  { key: 'walking', labelKey: 'filters.walking', types: ['Walk'] },
  {
    key: 'swimming',
    labelKey: 'filters.swimming',
    types: ['Swim', 'OpenWaterSwim'],
  },
  {
    key: 'snow',
    labelKey: 'filters.snowSports',
    types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard', 'Snowshoe'],
  },
  {
    key: 'water',
    labelKey: 'filters.waterSports',
    types: ['Rowing', 'Kayaking', 'Canoeing'],
  },
  { key: 'climbing', labelKey: 'filters.climbing', types: ['RockClimbing'] },
  { key: 'racket', labelKey: 'filters.racketSports', types: ['Tennis'] },
  {
    key: 'other',
    labelKey: 'filters.other',
    types: ['Workout', 'WeightTraining', 'Yoga', 'Other'],
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MapsSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [showActivityStyles, setShowActivityStyles] = useState(false);
  const {
    preferences: mapPreferences,
    setDefaultStyle,
    setActivityGroupStyle,
    setTerrain3D,
    setTerrain3DGroup,
    isTerrain3DEnabled,
  } = useMapPreferences();

  // Terrain cache stats
  const [terrainCacheSize, setTerrainCacheSize] = useState(0);

  useEffect(() => {
    getTerrainPreviewCacheSize().then(setTerrainCacheSize);
  }, [mapPreferences.terrain3DDefault, mapPreferences.terrain3DByType]);

  // Migrate stale per-type 3D overrides: old code only set types[0] per group.
  // Normalize so all types in a group share the same override.
  useEffect(() => {
    const byType = mapPreferences.terrain3DByType;
    for (const group of MAP_ACTIVITY_GROUPS) {
      const lead = byType[group.types[0]];
      if (lead === undefined) continue;
      const needsFix = group.types.some((t) => byType[t] !== lead);
      if (needsFix) {
        setTerrain3DGroup(group.types, lead);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDefaultMapStyleChange = async (value: string) => {
    const style = value as MapStyleType;
    await setDefaultStyle(style);
  };

  const handleActivityGroupMapStyleChange = async (groupKey: string, value: string) => {
    const group = MAP_ACTIVITY_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;

    const style = value === 'default' ? null : (value as MapStyleType);
    await setActivityGroupStyle(group.types, style);
  };

  const handleTerrain3DDefaultToggle = async (enabled: boolean) => {
    await setTerrain3D(null, enabled);
  };

  const handleClearTerrainCache = async () => {
    await clearTerrainPreviews();
    setTerrainCacheSize(0);
  };

  return (
    <>
      <View style={styles.sectionLabelRow}>
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.maps').toUpperCase()}
        </Text>
        {terrainCacheSize > 0 && (
          <TouchableOpacity onPress={handleClearTerrainCache} style={styles.cacheClearButton}>
            <Text style={[styles.cacheClearText, isDark && styles.textMuted]}>
              {t('settings.terrainCacheSize', {
                defaultValue: 'Cache: {{size}}',
                size: formatBytes(terrainCacheSize),
              })}
              {'  '}
            </Text>
            <Text style={styles.cacheClearAction}>
              {t('settings.clearCache', { defaultValue: 'Clear' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <View style={styles.mapStyleRow}>
          <Text style={[styles.mapStyleLabel, isDark && styles.textLight]}>
            {t('settings.defaultStyle')}
          </Text>
        </View>
        <MapStylePreviewPicker
          value={mapPreferences.defaultStyle}
          onValueChange={handleDefaultMapStyleChange}
        />

        {/* 3D Terrain toggle */}
        <View style={[styles.actionRow, styles.actionRowBorder]}>
          <MaterialCommunityIcons name="image-filter-hdr" size={22} color={colors.primary} />
          <View style={styles.terrain3DTextContainer}>
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('settings.terrain3D', { defaultValue: '3D Terrain' })}
            </Text>
            <Text style={[styles.terrain3DHint, isDark && styles.textMuted]}>
              {t('settings.terrain3DHint', {
                defaultValue: 'Pre-rendered 3D terrain in feed cards',
              })}
            </Text>
          </View>
          <Switch
            value={mapPreferences.terrain3DDefault}
            onValueChange={handleTerrain3DDefaultToggle}
            trackColor={{ false: isDark ? darkColors.border : colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>

        {/* Per-activity-type styles toggle */}
        <TouchableOpacity
          style={[styles.actionRow, styles.actionRowBorder]}
          onPress={() => setShowActivityStyles(!showActivityStyles)}
        >
          <MaterialCommunityIcons name="tune-variant" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {t('settings.customiseByActivity')}
          </Text>
          <MaterialCommunityIcons
            name={showActivityStyles ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Per-activity-group pickers */}
        {showActivityStyles && (
          <View style={styles.activityStylesContainer}>
            {MAP_ACTIVITY_GROUPS.map(({ key, labelKey, types }) => {
              // Use the first type in the group to determine current style
              const currentStyle = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
              const terrain3DForGroup = isTerrain3DEnabled(types[0]);
              return (
                <View key={key} style={styles.activityStyleRow}>
                  <View style={styles.activityStyleHeader}>
                    <Text style={[styles.activityStyleLabel, isDark && styles.textLight]}>
                      {t(labelKey)}
                    </Text>
                    <View style={styles.terrain3DGroupToggle}>
                      <Text style={[styles.terrain3DGroupLabel, isDark && styles.textMuted]}>
                        3D
                      </Text>
                      <Switch
                        value={terrain3DForGroup}
                        onValueChange={(enabled) => setTerrain3DGroup(types, enabled)}
                        trackColor={{
                          false: isDark ? darkColors.border : colors.border,
                          true: colors.primary,
                        }}
                        thumbColor={colors.surface}
                        style={styles.terrain3DGroupSwitch}
                      />
                    </View>
                  </View>
                  <SegmentedButtons
                    value={currentStyle}
                    onValueChange={(value) => handleActivityGroupMapStyleChange(key, value)}
                    buttons={[
                      { value: 'default', label: t('settings.default') },
                      { value: 'light', label: t('settings.light') },
                      { value: 'dark', label: t('settings.dark') },
                      { value: 'satellite', label: t('settings.satellite') },
                    ]}
                    density="small"
                    style={styles.activityStylePicker}
                  />
                </View>
              );
            })}
            <Text style={[styles.activityStyleHint, isDark && styles.textMuted]}>
              {t('settings.defaultMapHint')}
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  cacheClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cacheClearText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  cacheClearAction: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  mapStyleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
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
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  terrain3DTextContainer: {
    flex: 1,
  },
  terrain3DHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  activityStylesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  activityStyleRow: {
    marginTop: spacing.md,
  },
  activityStyleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  activityStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityStylePicker: {
    // Handled by React Native Paper
  },
  activityStyleHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  terrain3DGroupToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  terrain3DGroupLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  terrain3DGroupSwitch: {
    transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }],
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
