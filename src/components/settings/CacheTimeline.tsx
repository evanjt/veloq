/**
 * CacheTimeline - Visual timeline showing cached activity date range.
 * Displays the period of data loaded into the cache with markers.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';

interface CacheTimelineProps {
  /** Oldest date in cache */
  oldestDate: string | null;
  /** Newest date in cache */
  newestDate: string | null;
  /** Oldest possible date (from API) */
  apiOldestDate?: string | null;
  /** Number of cached activities */
  activityCount: number;
  /** Whether sync is in progress */
  isSyncing?: boolean;
  /** Sync progress (0-100) */
  syncProgress?: number;
  /** Callback to expand the cache */
  onExpand?: () => void;
  /** Dark mode */
  isDark?: boolean;
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatYear(dateStr: string): string {
  return new Date(dateStr).getFullYear().toString();
}

export function CacheTimeline({
  oldestDate,
  newestDate,
  apiOldestDate,
  activityCount,
  isSyncing = false,
  syncProgress,
  onExpand,
  isDark = false,
}: CacheTimelineProps) {
  const { t } = useTranslation();
  const themeColors = isDark ? darkColors : colors;

  // Calculate timeline metrics
  const timelineData = useMemo(() => {
    const now = new Date();
    const nowTime = now.getTime();

    // Default to showing last 10 years if no API oldest date
    const apiOldest = apiOldestDate
      ? new Date(apiOldestDate).getTime()
      : nowTime - 10 * 365 * 24 * 60 * 60 * 1000;
    const totalSpan = nowTime - apiOldest;

    if (!oldestDate || !newestDate || totalSpan <= 0) {
      return {
        startPercent: 0,
        endPercent: 100,
        cachedSpanPercent: 0,
        uncachedOlderPercent: 0,
        years: [],
      };
    }

    const cachedOldest = new Date(oldestDate).getTime();
    const cachedNewest = new Date(newestDate).getTime();

    // Calculate percentages on the timeline
    const startPercent = ((cachedOldest - apiOldest) / totalSpan) * 100;
    const endPercent = ((cachedNewest - apiOldest) / totalSpan) * 100;
    const cachedSpanPercent = endPercent - startPercent;
    const uncachedOlderPercent = startPercent;

    // Generate year markers
    const years: { year: string; position: number }[] = [];
    const startYear = new Date(apiOldest).getFullYear();
    const endYear = now.getFullYear();

    for (let year = startYear; year <= endYear; year++) {
      const yearStart = new Date(year, 0, 1).getTime();
      if (yearStart >= apiOldest && yearStart <= nowTime) {
        const position = ((yearStart - apiOldest) / totalSpan) * 100;
        years.push({ year: year.toString(), position });
      }
    }

    return {
      startPercent: Math.max(0, startPercent),
      endPercent: Math.min(100, endPercent),
      cachedSpanPercent,
      uncachedOlderPercent,
      years,
    };
  }, [oldestDate, newestDate, apiOldestDate]);

  const hasOlderData = timelineData.uncachedOlderPercent > 5;

  return (
    <View style={styles.container}>
      {/* Timeline track */}
      <View style={[styles.track, isDark && styles.trackDark]}>
        {/* Uncached older region (if any) */}
        {hasOlderData && (
          <View style={[styles.uncachedRegion, { width: `${timelineData.uncachedOlderPercent}%` }]}>
            <View style={[styles.stripes, isDark && styles.stripesDark]} />
          </View>
        )}

        {/* Cached region */}
        <View
          style={[
            styles.cachedRegion,
            {
              left: `${timelineData.startPercent}%`,
              width: `${Math.max(2, timelineData.cachedSpanPercent)}%`,
            },
          ]}
        />

        {/* Sync progress overlay */}
        {isSyncing && syncProgress !== undefined && (
          <View
            style={[
              styles.syncProgress,
              {
                left: `${timelineData.startPercent}%`,
                width: `${(syncProgress / 100) * timelineData.cachedSpanPercent}%`,
              },
            ]}
          />
        )}

        {/* Year markers */}
        {timelineData.years
          .filter((_, i, arr) => arr.length <= 6 || i % Math.ceil(arr.length / 6) === 0)
          .map(({ year, position }) => (
            <View key={year} style={[styles.yearMarker, { left: `${position}%` }]}>
              <View style={[styles.yearTick, isDark && styles.yearTickDark]} />
              <Text style={[styles.yearLabel, isDark && styles.yearLabelDark]}>{year}</Text>
            </View>
          ))}
      </View>

      {/* Info row */}
      <View style={styles.infoRow}>
        <View style={styles.dateRange}>
          <Text style={[styles.dateText, isDark && styles.textMuted]}>
            {formatShortDate(oldestDate)} — {formatShortDate(newestDate)}
          </Text>
          <Text style={[styles.countText, isDark && styles.textLight]}>
            {activityCount} {t('common.activities', 'activities')}
          </Text>
        </View>

        {/* Expand button */}
        {hasOlderData && onExpand && (
          <TouchableOpacity
            style={[styles.expandButton, isDark && styles.expandButtonDark]}
            onPress={onExpand}
            disabled={isSyncing}
          >
            <MaterialCommunityIcons
              name="calendar-expand-horizontal"
              size={16}
              color={isSyncing ? themeColors.textSecondary : themeColors.primary}
            />
            <Text
              style={[
                styles.expandText,
                { color: isSyncing ? themeColors.textSecondary : themeColors.primary },
              ]}
            >
              {isSyncing
                ? t('common.syncing', 'Syncing...')
                : t('settings.expandCache', 'Load more')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.legendText, isDark && styles.textMuted]}>
            {t('settings.cached', 'Cached')}
          </Text>
        </View>
        {hasOlderData && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.legendDotStriped]} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>
              {t('settings.notCached', 'Not cached')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  track: {
    height: 24,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  trackDark: {
    backgroundColor: '#333',
  },
  uncachedRegion: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  stripes: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F5F5F5',
    // Diagonal stripes using transform would require SVG, so we use a dotted pattern instead
    opacity: 0.5,
  },
  stripesDark: {
    backgroundColor: '#222',
  },
  cachedRegion: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  syncProgress: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  yearMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    transform: [{ translateX: -0.5 }],
  },
  yearTick: {
    width: 1,
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  yearTickDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  yearLabel: {
    fontSize: 9,
    color: '#666',
    marginTop: 1,
  },
  yearLabelDark: {
    color: '#888',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  dateRange: {
    flex: 1,
  },
  dateText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 2,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(0, 150, 136, 0.1)',
    borderRadius: 16,
  },
  expandButtonDark: {
    backgroundColor: 'rgba(0, 150, 136, 0.2)',
  },
  expandText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  legend: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    marginRight: 4,
  },
  legendDotStriped: {
    backgroundColor: '#E0E0E0',
    borderWidth: 1,
    borderColor: '#CCC',
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
});
