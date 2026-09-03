import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/shared/app/navigation';
import { formatFullDate, formatFileSize } from '@/shared/format/format';
import { type TileCacheStats } from '@/features/maps/lib/terrainSnapshotEvents';
import { TILE_CACHE_BUDGET_CHOICES_MB } from '@/features/maps/lib/tileCacheBudget';
import { useTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';
import { mapCacheTotal } from '../lib/mapCacheTotal';
import { colors, darkColors, spacing } from '@/theme';

import { StreamHistoryRow } from './StreamHistoryRow';

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatFullDate(dateStr);
}

/** Every segment the bar can draw. A key, never a literal: the legend was the
 * one thing on this screen that stayed in English. */
type SegmentKey =
  | 'settings.storageDatabase'
  | 'settings.storageHeatmap'
  | 'settings.storageSatellite'
  | 'settings.storageTerrain'
  | 'settings.storageVector'
  | 'settings.storageGround'
  | 'settings.storagePreviews';

interface StorageBarSegment {
  labelKey: SegmentKey;
  bytes: number;
  color: string;
}

/** Segment names are keys, never literals: this is the only chart on the screen
 * and its legend was the one thing on it that stayed in English. */
function StorageBreakdownBar({
  routesSize,
  tileCacheStats,
  terrainCacheSize,
  heatmapCacheSize,
  freeStorage,
  isDark,
}: {
  routesSize: number;
  tileCacheStats: TileCacheStats | null;
  terrainCacheSize: number;
  heatmapCacheSize: number;
  freeStorage: number | null;
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const segments = useMemo<StorageBarSegment[]>(() => {
    const result: StorageBarSegment[] = [];
    if (routesSize > 0) {
      result.push({
        labelKey: 'settings.storageDatabase',
        bytes: routesSize,
        color: colors.primary,
      });
    }
    if (heatmapCacheSize > 0) {
      result.push({
        labelKey: 'settings.storageHeatmap',
        bytes: heatmapCacheSize,
        color: colors.cautionOrange,
      });
    }
    if (tileCacheStats?.satellite?.totalBytes) {
      result.push({
        labelKey: 'settings.storageSatellite',
        bytes: tileCacheStats.satellite.totalBytes,
        color: colors.chartPurple,
      });
    }
    if (tileCacheStats?.terrain?.totalBytes) {
      result.push({
        labelKey: 'settings.storageTerrain',
        bytes: tileCacheStats.terrain.totalBytes,
        color: colors.chartGreen,
      });
    }
    if (tileCacheStats?.vector?.totalBytes) {
      result.push({
        labelKey: 'settings.storageVector',
        bytes: tileCacheStats.vector.totalBytes,
        color: colors.chartCyan,
      });
    }
    if (tileCacheStats?.ground?.totalBytes) {
      result.push({
        labelKey: 'settings.storageGround',
        bytes: tileCacheStats.ground.totalBytes,
        color: colors.chartAmber,
      });
    }
    if (terrainCacheSize > 0) {
      result.push({
        labelKey: 'settings.storagePreviews',
        bytes: terrainCacheSize,
        color: colors.chartYellow,
      });
    }
    return result;
  }, [routesSize, tileCacheStats, terrainCacheSize, heatmapCacheSize]);

  const totalCacheBytes = segments.reduce((sum, s) => sum + s.bytes, 0);

  if (totalCacheBytes === 0) return null;

  const freeColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const totalDevice = freeStorage !== null ? totalCacheBytes + freeStorage : 0;
  const deviceUsagePct = totalDevice > 0 ? (totalCacheBytes / totalDevice) * 100 : 0;

  return (
    <View style={styles.storageBarContainer}>
      <View style={styles.storageBar}>
        {segments.map((seg) => {
          const pct = totalCacheBytes > 0 ? (seg.bytes / totalCacheBytes) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <View
              key={seg.labelKey}
              style={[styles.storageBarSegment, { width: `${pct}%`, backgroundColor: seg.color }]}
            />
          );
        })}
      </View>
      <View style={styles.storageLegend}>
        {segments.map((seg) => (
          <View key={seg.labelKey} style={styles.storageLegendItem}>
            <View style={[styles.storageLegendDot, { backgroundColor: seg.color }]} />
            <Text
              testID="storage-legend-label"
              style={[styles.storageLegendText, isDark && styles.textMuted]}
            >
              {t(seg.labelKey)} {formatFileSize(seg.bytes)}
            </Text>
          </View>
        ))}
      </View>
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
          <Text style={[styles.storageLegendText, { marginTop: 2 }, isDark && styles.textMuted]}>
            {formatFileSize(totalCacheBytes)} of {formatFileSize(totalDevice)} used
          </Text>
        </>
      )}
    </View>
  );
}

export interface StorageStatsPanelProps {
  isDark: boolean;
  totalActivities: number;
  routeGroupCount: number;
  totalSections: number;
  routeMatchingEnabled: boolean;
  dateRangeText: string;
  lastSync: string | null;
  totalQueries: number;
  databaseSize: number;
  onClearMapCache: () => void;
  routesSize: number;
  tileCacheStats: TileCacheStats | null;
  terrainCacheSize: number;
  heatmapCacheSize: number;
  freeStorage: number | null;
}

export function StorageStatsPanel({
  isDark,
  totalActivities,
  routeGroupCount,
  totalSections,
  routeMatchingEnabled,
  dateRangeText,
  lastSync,
  totalQueries,
  databaseSize,
  onClearMapCache,
  routesSize,
  tileCacheStats,
  terrainCacheSize,
  heatmapCacheSize,
  freeStorage,
}: StorageStatsPanelProps) {
  const { t } = useTranslation();
  const total = mapCacheTotal({
    terrainBytes: terrainCacheSize,
    heatmapBytes: heatmapCacheSize,
    tileStats: tileCacheStats,
  });
  const budgetMb = useTileCacheSettings((state) => state.budgetMb);
  const setBudgetMb = useTileCacheSettings((state) => state.setBudgetMb);

  // A cycle rather than a picker: four values, and the row already reads as one
  // line beside the size it governs.
  const cycleBudget = useCallback(() => {
    const next =
      TILE_CACHE_BUDGET_CHOICES_MB[
        (TILE_CACHE_BUDGET_CHOICES_MB.indexOf(budgetMb) + 1) % TILE_CACHE_BUDGET_CHOICES_MB.length
      ];
    setBudgetMb(next);
  }, [budgetMb, setBudgetMb]);

  return (
    <>
      {/* Cache Stats - inline */}
      <View testID="settings-storage-stats" style={styles.statRow}>
        <TouchableOpacity
          style={styles.statItem}
          onPress={() => navigateTo('/map')}
          activeOpacity={0.7}
        >
          <Text style={[styles.statValue, isDark && styles.textLight]}>{totalActivities}</Text>
          <Text style={[styles.statLabel, styles.statLabelClickable]}>
            {t('settings.activities')} ›
          </Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity
          style={styles.statItem}
          onPress={() => navigateTo('/insights?tab=routes')}
          disabled={!routeMatchingEnabled}
          activeOpacity={0.7}
        >
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {routeMatchingEnabled ? routeGroupCount : '-'}
          </Text>
          <Text
            style={[
              styles.statLabel,
              routeMatchingEnabled ? styles.statLabelClickable : isDark && styles.textMuted,
            ]}
          >
            {t('settings.routesCount')} ›
          </Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity
          style={styles.statItem}
          onPress={() => navigateTo('/insights?tab=sections')}
          disabled={!routeMatchingEnabled}
          activeOpacity={0.7}
        >
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {routeMatchingEnabled ? totalSections : '-'}
          </Text>
          <Text
            style={[
              styles.statLabel,
              routeMatchingEnabled ? styles.statLabelClickable : isDark && styles.textMuted,
            ]}
          >
            {t('settings.sectionsCount')} ›
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
          {t('settings.dateRange')}
        </Text>
        <Text style={[styles.infoValue, isDark && styles.textLight]}>{dateRangeText}</Text>
      </View>

      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
          {t('settings.lastSynced')}
        </Text>
        <Text style={[styles.infoValue, isDark && styles.textLight]}>
          {formatDateOrDash(lastSync)}
        </Text>
      </View>

      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
          {t('settings.cachedQueries')}
        </Text>
        <Text style={[styles.infoValue, isDark && styles.textLight]}>{totalQueries}</Text>
      </View>

      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text style={[styles.infoLabel, isDark && styles.textMuted]}>{t('settings.database')}</Text>
        <Text style={[styles.infoValue, isDark && styles.textLight]}>
          {formatFileSize(databaseSize)}
        </Text>
      </View>

      <StreamHistoryRow isDark={isDark} />

      {/* Everything the map draws from, which is previews, heatmap and tiles. */}
      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text
          testID="settings-map-cache-label"
          style={[styles.infoLabel, isDark && styles.textMuted]}
        >
          {t('settings.mapCache')}
        </Text>
        <View style={styles.infoValueRow}>
          <Text
            testID="settings-map-cache-value"
            style={[styles.infoValue, isDark && styles.textLight]}
          >
            {total.bytes > 0
              ? total.complete
                ? formatFileSize(total.bytes)
                : t('settings.sizeAtLeast', { size: formatFileSize(total.bytes) })
              : '-'}
          </Text>
          {total.bytes > 0 && (
            <TouchableOpacity onPress={onClearMapCache} style={styles.clearInlineButton}>
              <Text style={styles.clearInlineText}>{t('settings.clearCache')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* The one control Q23 left: how much of the device the tiles may hold. */}
      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
          {t('settings.tileCacheLimit')}
        </Text>
        <TouchableOpacity
          testID="settings-tile-cache-limit"
          onPress={cycleBudget}
          style={styles.infoValueRow}
          accessibilityRole="button"
        >
          <Text style={[styles.infoValue, styles.statLabelClickable]}>
            {formatFileSize(budgetMb * 1024 * 1024)} ›
          </Text>
        </TouchableOpacity>
      </View>

      {/* Storage breakdown bar */}
      <StorageBreakdownBar
        routesSize={routesSize}
        tileCacheStats={tileCacheStats}
        terrainCacheSize={terrainCacheSize}
        heatmapCacheSize={heatmapCacheSize}
        freeStorage={freeStorage}
        isDark={isDark}
      />
    </>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  statLabelClickable: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowDark: {
    borderTopColor: darkColors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  clearInlineButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  clearInlineText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  storageBarContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
