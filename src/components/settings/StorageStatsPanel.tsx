import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatFullDate, formatFileSize, navigateTo } from '@/lib';
import { type TileCacheStats } from '@/lib/events/terrainSnapshotEvents';
import { colors, darkColors, spacing } from '@/theme';

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatFullDate(dateStr);
}

interface StorageBarSegment {
  label: string;
  bytes: number;
  color: string;
}

function StorageBreakdownBar({
  routesSize,
  nativeSizeEstimate,
  tileCacheStats,
  terrainCacheSize,
  heatmapCacheSize,
  freeStorage,
  isDark,
}: {
  routesSize: number;
  nativeSizeEstimate: number;
  tileCacheStats: TileCacheStats | null;
  terrainCacheSize: number;
  heatmapCacheSize: number;
  freeStorage: number | null;
  isDark: boolean;
}) {
  const segments = useMemo<StorageBarSegment[]>(() => {
    const result: StorageBarSegment[] = [];
    if (routesSize > 0) {
      result.push({ label: 'Database', bytes: routesSize, color: colors.primary });
    }
    if (heatmapCacheSize > 0) {
      result.push({ label: 'Heatmap', bytes: heatmapCacheSize, color: '#FF9800' });
    }
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
  }, [routesSize, nativeSizeEstimate, tileCacheStats, terrainCacheSize, heatmapCacheSize]);

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
              key={seg.label}
              style={[styles.storageBarSegment, { width: `${pct}%`, backgroundColor: seg.color }]}
            />
          );
        })}
      </View>
      <View style={styles.storageLegend}>
        {segments.map((seg) => (
          <View key={seg.label} style={styles.storageLegendItem}>
            <View style={[styles.storageLegendDot, { backgroundColor: seg.color }]} />
            <Text style={[styles.storageLegendText, isDark && styles.textMuted]}>
              {seg.label} {formatFileSize(seg.bytes)}
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
  totalMapCache: number;
  onClearMapCache: () => void;
  routesSize: number;
  nativeSizeEstimate: number;
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
  totalMapCache,
  onClearMapCache,
  routesSize,
  nativeSizeEstimate,
  tileCacheStats,
  terrainCacheSize,
  heatmapCacheSize,
  freeStorage,
}: StorageStatsPanelProps) {
  const { t } = useTranslation();

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
          onPress={() => navigateTo('/routes?tab=routes')}
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
          onPress={() => navigateTo('/routes?tab=sections')}
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

      {/* Map tiles cache row with clear button */}
      <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
        <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
          {t('settings.mapTiles', { defaultValue: 'Map tiles' })}
        </Text>
        <View style={styles.infoValueRow}>
          <Text style={[styles.infoValue, isDark && styles.textLight]}>
            {totalMapCache > 0 ? formatFileSize(totalMapCache) : '-'}
          </Text>
          {totalMapCache > 0 && (
            <TouchableOpacity onPress={onClearMapCache} style={styles.clearInlineButton}>
              <Text style={styles.clearInlineText}>
                {t('settings.clearCache', { defaultValue: 'Clear' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Storage breakdown bar */}
      <StorageBreakdownBar
        routesSize={routesSize}
        nativeSizeEstimate={nativeSizeEstimate}
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
