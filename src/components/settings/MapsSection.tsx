import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
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
import {
  emitClearTileCache,
  requestTileCacheStats,
  onTileCacheStats,
  type TileCacheStats,
} from '@/lib/events/terrainSnapshotEvents';
import { colors, darkColors, spacing, layout } from '@/theme';
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
    setTerrain3DMode,
    setTerrain3DModeGroup,
    getTerrain3DMode,
  } = useMapPreferences();

  // Terrain cache stats
  const [terrainCacheSize, setTerrainCacheSize] = useState(0);
  const [tileCacheStats, setTileCacheStats] = useState<TileCacheStats | null>(null);

  useEffect(() => {
    getTerrainPreviewCacheSize().then(setTerrainCacheSize);
  }, [mapPreferences.terrain3DMode, mapPreferences.terrain3DModeByType]);

  // Request DEM tile cache stats from WebView on mount
  useEffect(() => {
    const unsub = onTileCacheStats(setTileCacheStats);
    requestTileCacheStats();
    // Timeout: if no WebView is mounted (3D disabled), stats stay null
    const timeout = setTimeout(() => {
      setTileCacheStats((prev) => prev ?? null);
    }, 500);
    return () => {
      unsub();
      clearTimeout(timeout);
    };
  }, []);

  // Migrate stale per-type 3D overrides: old code only set types[0] per group.
  // Normalize so all types in a group share the same override.
  useEffect(() => {
    const byType = mapPreferences.terrain3DModeByType;
    for (const group of MAP_ACTIVITY_GROUPS) {
      const lead = byType[group.types[0]];
      if (lead === undefined) continue;
      const needsFix = group.types.some((t) => byType[t] !== lead);
      if (needsFix) {
        setTerrain3DModeGroup(group.types, lead);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDefaultMapStyleChange = async (value: string) => {
    const style = value as MapStyleType;
    await setDefaultStyle(style);
    await clearTerrainPreviews();
    setTerrainCacheSize(0);
  };

  const handleActivityGroupMapStyleChange = async (groupKey: string, value: string) => {
    const group = MAP_ACTIVITY_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;

    const style = value === 'default' ? null : (value as MapStyleType);
    await setActivityGroupStyle(group.types, style);
    await clearTerrainPreviews();
    setTerrainCacheSize(0);
  };

  const handleTerrain3DModeChange = async (mode: string) => {
    await setTerrain3DMode(null, mode as Terrain3DMode);
    await clearTerrainPreviews();
    setTerrainCacheSize(0);
  };

  const handleTerrain3DGroupModeChange = async (types: ActivityType[], mode: string) => {
    await setTerrain3DModeGroup(types, mode as Terrain3DMode);
    await clearTerrainPreviews();
    setTerrainCacheSize(0);
  };

  const handleClearTerrainCache = async () => {
    await clearTerrainPreviews();
    emitClearTileCache();
    setTerrainCacheSize(0);
    setTileCacheStats(null);
  };

  return (
    <>
      <View style={styles.sectionLabelRow}>
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.maps').toUpperCase()}
        </Text>
        {(terrainCacheSize > 0 || (tileCacheStats?.totalBytes ?? 0) > 0) && (
          <View style={styles.cacheClearContainer}>
            <TouchableOpacity onPress={handleClearTerrainCache} style={styles.cacheClearButton}>
              <Text style={[styles.cacheClearText, isDark && styles.textMuted]}>
                {t('settings.mapCacheSize', {
                  defaultValue: 'Map cache: {{size}}',
                  size: formatBytes(terrainCacheSize + (tileCacheStats?.totalBytes ?? 0)),
                })}
                {'  '}
              </Text>
              <Text style={styles.cacheClearAction}>
                {t('settings.clearCache', { defaultValue: 'Clear' })}
              </Text>
            </TouchableOpacity>
            {(tileCacheStats?.tileCount ?? 0) > 0 && (
              <Text style={[styles.tileCacheDetail, isDark && styles.textMuted]}>
                {[
                  tileCacheStats?.satellite?.tileCount
                    ? `${tileCacheStats.satellite.tileCount.toLocaleString()} satellite`
                    : null,
                  tileCacheStats?.terrain?.tileCount
                    ? `${tileCacheStats.terrain.tileCount.toLocaleString()} terrain`
                    : null,
                  tileCacheStats?.vector?.tileCount
                    ? `${tileCacheStats.vector.tileCount.toLocaleString()} vector`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' \u00B7 ') + ' tiles'}
              </Text>
            )}
          </View>
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

        {/* 3D Terrain mode picker */}
        <View style={[styles.actionRow, styles.actionRowBorder]}>
          <MaterialCommunityIcons name="image-filter-hdr" size={22} color={colors.primary} />
          <View style={styles.terrain3DTextContainer}>
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('settings.terrain3D', { defaultValue: '3D Terrain' })}
            </Text>
            <Text style={[styles.terrain3DHint, isDark && styles.textMuted]}>
              {t('settings.terrain3DHint', {
                defaultValue: 'Smart mode shows 3D for hilly and mountainous terrain',
              })}
            </Text>
          </View>
        </View>
        <View style={styles.terrain3DPickerContainer}>
          <SegmentedButtons
            value={mapPreferences.terrain3DMode}
            onValueChange={handleTerrain3DModeChange}
            buttons={[
              { value: 'off', label: t('settings.terrain3DOff', { defaultValue: 'Off' }) },
              { value: 'smart', label: t('settings.terrain3DSmart', { defaultValue: 'Smart' }) },
              {
                value: 'always',
                label: t('settings.terrain3DAlways', { defaultValue: 'Always' }),
              },
            ]}
            density="small"
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
              const terrain3DModeForGroup = getTerrain3DMode(types[0]);
              return (
                <View key={key} style={styles.activityStyleRow}>
                  <View style={styles.activityStyleHeader}>
                    <Text style={[styles.activityStyleLabel, isDark && styles.textLight]}>
                      {t(labelKey)}
                    </Text>
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
                  <View style={styles.terrain3DGroupRow}>
                    <Text style={[styles.terrain3DGroupLabel, isDark && styles.textMuted]}>3D</Text>
                    <SegmentedButtons
                      value={terrain3DModeForGroup}
                      onValueChange={(value) => handleTerrain3DGroupModeChange(types, value)}
                      buttons={[
                        {
                          value: 'off',
                          label: t('settings.terrain3DOff', { defaultValue: 'Off' }),
                        },
                        {
                          value: 'smart',
                          label: t('settings.terrain3DSmart', { defaultValue: 'Smart' }),
                        },
                        {
                          value: 'always',
                          label: t('settings.terrain3DAlways', { defaultValue: 'Always' }),
                        },
                      ]}
                      density="small"
                      style={styles.terrain3DGroupPicker}
                    />
                  </View>
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
  cacheClearContainer: {
    alignItems: 'flex-end',
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
  tileCacheDetail: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 1,
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
  terrain3DPickerContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
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
  terrain3DGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  terrain3DGroupLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  terrain3DGroupPicker: {
    flex: 1,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
