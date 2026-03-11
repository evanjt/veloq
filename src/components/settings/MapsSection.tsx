import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, SegmentedButtons, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/providers';
import { useTileCacheStore, type CacheMode } from '@/providers/TileCacheStore';
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
import * as TileCacheService from '@/lib/maps/tileCacheService';
import * as FileSystem from 'expo-file-system/legacy';
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
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface StorageBarSegment {
  label: string;
  bytes: number;
  color: string;
}

function StorageBreakdownBar({
  nativeSizeEstimate,
  tileCacheStats,
  terrainCacheSize,
  freeStorage,
  isDark,
}: {
  nativeSizeEstimate: number;
  tileCacheStats: TileCacheStats | null;
  terrainCacheSize: number;
  freeStorage: number | null;
  isDark: boolean;
}) {
  const segments = useMemo<StorageBarSegment[]>(() => {
    const result: StorageBarSegment[] = [];
    if (nativeSizeEstimate > 0) {
      result.push({ label: 'Map packs', bytes: nativeSizeEstimate, color: colors.chartBlue });
    }
    if (tileCacheStats?.satellite?.totalBytes) {
      result.push({
        label: 'Satellite',
        bytes: tileCacheStats.satellite.totalBytes,
        color: colors.chartPurple,
      });
    }
    if (tileCacheStats?.terrain?.totalBytes) {
      result.push({
        label: 'Terrain',
        bytes: tileCacheStats.terrain.totalBytes,
        color: colors.chartGreen,
      });
    }
    if (tileCacheStats?.vector?.totalBytes) {
      result.push({
        label: 'Vector',
        bytes: tileCacheStats.vector.totalBytes,
        color: colors.chartCyan,
      });
    }
    if (terrainCacheSize > 0) {
      result.push({ label: '3D previews', bytes: terrainCacheSize, color: colors.chartYellow });
    }
    return result;
  }, [nativeSizeEstimate, tileCacheStats, terrainCacheSize]);

  const totalCacheBytes = segments.reduce((sum, s) => sum + s.bytes, 0);

  if (totalCacheBytes === 0) return null;

  const freeColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const totalDevice = freeStorage !== null ? totalCacheBytes + freeStorage : 0;
  const deviceUsagePct = totalDevice > 0 ? (totalCacheBytes / totalDevice) * 100 : 0;

  return (
    <View style={[styles.actionRowBorder, styles.storageBarContainer]}>
      {/* App cache breakdown bar */}
      <View style={styles.storageBar}>
        {segments.map((seg) => {
          const pct = totalCacheBytes > 0 ? (seg.bytes / totalCacheBytes) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <View
              key={seg.label}
              style={[styles.storageBarSegment, { width: `${pct}%`, backgroundColor: seg.color }]}
            />
          );
        })}
      </View>
      {/* App cache legend — directly under cache bar */}
      <View style={styles.storageLegend}>
        {segments.map((seg) => (
          <View key={seg.label} style={styles.storageLegendItem}>
            <View style={[styles.storageLegendDot, { backgroundColor: seg.color }]} />
            <Text style={[styles.storageLegendText, isDark && styles.textMuted]}>
              {seg.label} {formatBytes(seg.bytes)}
            </Text>
          </View>
        ))}
      </View>

      {/* Device usage bar */}
      {freeStorage !== null && (
        <>
          <View style={styles.deviceUsageBar}>
            <View
              style={[
                styles.deviceUsageBarFill,
                {
                  width: `${Math.max(deviceUsagePct, 2)}%`,
                  backgroundColor: colors.chartBlue,
                },
              ]}
            />
            <View style={[styles.deviceUsageBarFree, { backgroundColor: freeColor }]} />
          </View>
          {/* Device label — directly under device bar */}
          <Text style={[styles.storageLegendText, { marginTop: 2 }, isDark && styles.textMuted]}>
            {formatBytes(totalCacheBytes)} of {formatBytes(totalDevice)} used
          </Text>
        </>
      )}
    </View>
  );
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

  const handleClearAllMapCache = async () => {
    await clearTerrainPreviews();
    await TileCacheService.clearAllPacks();
    emitClearTileCache();
    setTerrainCacheSize(0);
    setTileCacheStats(null);
  };

  // Offline tile cache store
  const {
    settings: tileCacheSettings,
    prefetchStatus,
    progress: prefetchProgress,
    nativePackCount,
    nativeSizeEstimate,
    errorMessage: tileCacheError,
  } = useTileCacheStore();
  const tileCacheActions = useTileCacheStore();

  const [freeStorage, setFreeStorage] = useState<number | null>(null);

  useEffect(() => {
    FileSystem.getFreeDiskStorageAsync()
      .then(setFreeStorage)
      .catch(() => setFreeStorage(null));
  }, []);

  const lowStorage = freeStorage !== null && freeStorage < 500 * 1024 * 1024;
  const canUseMaximum = freeStorage === null || freeStorage >= 2 * 1024 * 1024 * 1024;

  // Total map cache for header display
  const totalMapCache = nativeSizeEstimate + terrainCacheSize + (tileCacheStats?.totalBytes ?? 0);

  // 3D terrain mode label
  const terrain3DLabel =
    mapPreferences.terrain3DMode === 'off'
      ? t('settings.terrain3DOff', { defaultValue: 'Off' })
      : mapPreferences.terrain3DMode === 'smart'
        ? t('settings.terrain3DSmart', { defaultValue: 'Smart' })
        : t('settings.terrain3DAlways', { defaultValue: 'Always' });

  return (
    <>
      <View style={styles.sectionLabelRow}>
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.maps').toUpperCase()}
        </Text>
        {totalMapCache > 0 && (
          <TouchableOpacity onPress={handleClearAllMapCache} style={styles.cacheClearButton}>
            <Text style={[styles.cacheClearText, isDark && styles.textMuted]}>
              {formatBytes(totalMapCache)}
              {nativePackCount > 0 ? ` · ${nativePackCount} regions` : ''}
              {'  '}
            </Text>
            <Text style={styles.cacheClearAction}>
              {t('settings.clearCache', { defaultValue: 'Clear' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Default style + 3D terrain toggle in header row */}
        <View style={styles.styleHeaderRow}>
          <Text style={[styles.mapStyleLabel, isDark && styles.textLight]}>
            {t('settings.defaultStyle')}
          </Text>
          <TouchableOpacity
            style={styles.terrain3DBadge}
            onPress={() => {
              // Cycle: off → smart → always → off
              const modes: Terrain3DMode[] = ['off', 'smart', 'always'];
              const idx = modes.indexOf(mapPreferences.terrain3DMode);
              handleTerrain3DModeChange(modes[(idx + 1) % 3]);
            }}
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

        {/* Offline tile caching — integrated into maps card */}
        <View style={[styles.offlineRow, styles.actionRowBorder]}>
          <MaterialCommunityIcons name="download-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {t('settings.autoDownloadTiles', { defaultValue: 'Auto-download map tiles' })}
          </Text>
          <Switch
            value={tileCacheSettings.enabled}
            onValueChange={tileCacheActions.setEnabled}
            color={colors.primary}
          />
        </View>

        {tileCacheSettings.enabled && (
          <>
            {/* Wi-Fi only toggle */}
            <View style={[styles.offlineRow, styles.actionRowBorder]}>
              <MaterialCommunityIcons name="wifi" size={22} color={colors.primary} />
              <Text style={[styles.actionText, isDark && styles.textLight]}>
                {t('settings.wifiOnly', { defaultValue: 'Wi-Fi only' })}
              </Text>
              <Switch
                value={tileCacheSettings.wifiOnly}
                onValueChange={tileCacheActions.setWifiOnly}
                color={colors.primary}
              />
            </View>

            {/* Cache mode picker */}
            <View
              style={[
                styles.actionRowBorder,
                { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
              ]}
            >
              <Text style={[styles.offlineModeLabel, isDark && styles.textLight]}>
                {t('settings.cacheMode', { defaultValue: 'Cache mode' })}
              </Text>
              <SegmentedButtons
                value={tileCacheSettings.cacheMode}
                onValueChange={(value) => tileCacheActions.setCacheMode(value as CacheMode)}
                buttons={[
                  {
                    value: 'standard',
                    label: t('settings.cacheModeStandard', { defaultValue: 'Standard' }),
                  },
                  {
                    value: 'maximum',
                    label: t('settings.cacheModeMaximum', { defaultValue: 'Maximum' }),
                    disabled: !canUseMaximum,
                  },
                ]}
                density="small"
                style={{ marginTop: spacing.xs }}
              />
              <Text style={[styles.offlineModeHint, isDark && styles.textMuted]}>
                {tileCacheSettings.cacheMode === 'standard'
                  ? t('settings.cacheModeStandardHint', {
                      defaultValue: '5 km radius · active style · ~84 MB for 5 regions',
                    })
                  : t('settings.cacheModeMaximumHint', {
                      defaultValue: '20 km radius · all styles · ~405 MB for 5 regions',
                    })}
              </Text>
              {!canUseMaximum && (
                <Text style={styles.offlineWarning}>
                  {t('settings.notEnoughStorage', {
                    defaultValue: 'Not enough storage for Maximum mode',
                  })}
                </Text>
              )}
            </View>

            {/* Status display */}
            {(prefetchStatus === 'downloading' ||
              prefetchStatus === 'computing' ||
              prefetchStatus === 'error' ||
              lowStorage) && (
              <View style={[styles.actionRowBorder, styles.offlineStatusRow]}>
                {prefetchStatus === 'downloading' && (
                  <View style={styles.offlineProgressRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.offlineStatusText, isDark && styles.textMuted]}>
                      {t('settings.downloading', {
                        defaultValue: 'Downloading {{done}}/{{total}} tiles...',
                        done: prefetchProgress.downloaded.toLocaleString(),
                        total: prefetchProgress.total.toLocaleString(),
                      })}
                    </Text>
                  </View>
                )}
                {prefetchStatus === 'computing' && (
                  <View style={styles.offlineProgressRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.offlineStatusText, isDark && styles.textMuted]}>
                      {t('settings.computing', {
                        defaultValue: 'Computing tile regions...',
                      })}
                    </Text>
                  </View>
                )}
                {prefetchStatus === 'error' && tileCacheError && (
                  <Text style={styles.offlineWarning}>{tileCacheError}</Text>
                )}
                {lowStorage && (
                  <Text style={styles.offlineWarning}>
                    {t('settings.lowStorage', {
                      defaultValue: 'Low device storage — tile download paused',
                    })}
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        {/* Storage breakdown bar — always visible if there's cache data */}
        <StorageBreakdownBar
          nativeSizeEstimate={nativeSizeEstimate}
          tileCacheStats={tileCacheStats}
          terrainCacheSize={terrainCacheSize}
          freeStorage={freeStorage}
          isDark={isDark}
        />
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
  styleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  terrain3DBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  terrain3DBadgeText: {
    fontSize: 11,
    fontWeight: '500',
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
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
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
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  offlineModeLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  offlineModeHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  offlineWarning: {
    fontSize: 12,
    color: '#E53935',
    marginTop: spacing.xs,
  },
  offlineStatusRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  offlineProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  offlineStatusText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  storageBarContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  storageBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  storageBarSegment: {
    height: '100%',
  },
  deviceUsageBar: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  deviceUsageBarFill: {
    height: '100%',
  },
  deviceUsageBarFree: {
    flex: 1,
    height: '100%',
  },
  storageLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  storageLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  storageLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  storageLegendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
});
