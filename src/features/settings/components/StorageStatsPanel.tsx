import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/shared/app/navigation';
import { formatFullDate, formatFileSize } from '@/shared/format/format';
import {
  BYTES_PER_BUDGET_MB,
  TILE_CACHE_BUDGET_CHOICES_MB,
  type BasemapTileSizes,
  useTileCacheSettings,
} from '@/features/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { mapCacheTotal } from '../lib/mapCacheTotal';
import {
  colors,
  darkColors,
  opacity,
  spacing,
  layout,
  typography,
  colorWithOpacity,
  ink,
} from '@/theme';

import { StreamBackfillRow } from './StreamBackfillRow';
import { StreamHistoryRow } from './StreamHistoryRow';
import { pressable, pressRipple } from '@/shared/ui';

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatFullDate(dateStr);
}

/** Every segment the bar can draw. A key, never a literal: the legend and
 * the total line beside it were once English literals. */
type SegmentKey =
  | 'settings.storageDatabase'
  | 'settings.storageHeatmap'
  | 'settings.storageVector'
  | 'settings.storageGround'
  | 'settings.storagePreviews'
  | 'settings.storageBackups';

interface StorageBarSegment {
  labelKey: SegmentKey;
  bytes: number;
  color: string;
}

/** Segment names are keys, never literals: this is the only chart on the screen
 * and its legend was the one thing on it that stayed in English. */
function StorageBreakdownBar({
  routesSize,
  basemapTiles,
  terrainCacheSize,
  heatmapCacheSize,
  athleteFilesSize,
  freeStorage,
  isDark,
}: {
  routesSize: number;
  basemapTiles: BasemapTileSizes | null;
  terrainCacheSize: number;
  heatmapCacheSize: number;
  athleteFilesSize: number;
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
        color: colors.linkTeal,
      });
    }
    if (heatmapCacheSize > 0) {
      result.push({
        labelKey: 'settings.storageHeatmap',
        bytes: heatmapCacheSize,
        color: colors.markOrange,
      });
    }
    const vectorBytes = basemapTiles?.vectorBytes ?? 0;
    const groundBytes = Math.max(0, (basemapTiles?.totalBytes ?? 0) - vectorBytes);
    if (vectorBytes > 0) {
      result.push({
        labelKey: 'settings.storageVector',
        bytes: vectorBytes,
        color: colors.markCyan,
      });
    }
    if (groundBytes > 0) {
      result.push({
        labelKey: 'settings.storageGround',
        bytes: groundBytes,
        color: colors.markAmber,
      });
    }
    if (terrainCacheSize > 0) {
      result.push({
        labelKey: 'settings.storagePreviews',
        bytes: terrainCacheSize,
        color: colors.markYellow,
      });
    }
    if (athleteFilesSize > 0) {
      result.push({
        labelKey: 'settings.storageBackups',
        bytes: athleteFilesSize,
        color: colors.markGreen,
      });
    }
    return result;
  }, [routesSize, basemapTiles, terrainCacheSize, heatmapCacheSize, athleteFilesSize]);

  // The bar segment and its legend dot read the one colour, so the mark tones
  // keep the two in step while making the segment visible on the light theme.
  const totalCacheBytes = segments.reduce((sum, s) => sum + s.bytes, 0);

  if (totalCacheBytes === 0) return null;

  const freeColor = isDark ? colorWithOpacity(ink.white, 0.12) : colorWithOpacity(ink.black, 0.08);
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
          <Text
            style={[
              styles.storageLegendText,
              { marginTop: spacing.xxs },
              isDark && styles.textMuted,
            ]}
          >
            {t('settings.storageUsedAndFree', {
              used: formatFileSize(totalCacheBytes),
              free: formatFileSize(freeStorage),
            })}
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
  onClearMapCache: () => void;
  routesSize: number;
  /** What the Rust tile store holds, or null until it has said. */
  basemapTiles: BasemapTileSizes | null;
  terrainCacheSize: number;
  heatmapCacheSize: number;
  /** Library copies, backups, recordings and share files. */
  athleteFilesSize: number;
  freeStorage: number | null;
  /** Called once the tile store has taken a new limit and evicted to it. */
  onBudgetApplied?: () => void;
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
  onClearMapCache,
  routesSize,
  basemapTiles,
  terrainCacheSize,
  heatmapCacheSize,
  athleteFilesSize,
  freeStorage,
  onBudgetApplied,
}: StorageStatsPanelProps) {
  const { t } = useTranslation();
  const total = mapCacheTotal({
    terrainBytes: terrainCacheSize,
    heatmapBytes: heatmapCacheSize,
    tiles: basemapTiles,
  });
  const budgetMb = useTileCacheSettings((state) => state.budgetMb);
  const setBudgetMb = useTileCacheSettings((state) => state.setBudgetMb);

  // A picker, not a cycle. Four rungs on a tap is a guessing game: reaching the
  // top from the bottom means tapping past two values you did not want, and
  // nothing on screen says what the rungs are until you have been through them.
  const [pickingBudget, setPickingBudget] = useState(false);
  const chooseBudget = useCallback(
    (mb: number) => {
      void Promise.resolve(setBudgetMb(mb)).then(() => onBudgetApplied?.());
      setPickingBudget(false);
    },
    [setBudgetMb, setPickingBudget, onBudgetApplied]
  );

  // What the tiles hold against what they are allowed, which is the question
  // the control is answering. A store that has not reported is a floor, not a
  // zero, the same way the total above says so.
  const budgetBytes = budgetMb * BYTES_PER_BUDGET_MB;
  const usedBytes = basemapTiles?.totalBytes ?? 0;
  const usedShare = budgetBytes > 0 ? Math.min(1, usedBytes / budgetBytes) : 0;

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
          <Text
            style={[
              styles.statLabel,
              styles.statLabelClickable,
              isDark && { color: darkColors.linkTeal },
            ]}
          >
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
              routeMatchingEnabled
                ? [styles.statLabelClickable, isDark && { color: darkColors.linkTeal }]
                : isDark && styles.textMuted,
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
              routeMatchingEnabled
                ? [styles.statLabelClickable, isDark && { color: darkColors.linkTeal }]
                : isDark && styles.textMuted,
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
          {formatFileSize(routesSize)}
        </Text>
      </View>

      <StreamHistoryRow isDark={isDark} />

      <StreamBackfillRow isDark={isDark} />

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
            <Pressable
              onPress={onClearMapCache}
              style={pressable(styles.clearInlineButton)}
              android_ripple={pressRipple}
            >
              <Text style={[styles.clearInlineText, isDark && { color: darkColors.linkTeal }]}>
                {t('settings.clearCache')}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* The one storage control the athlete has: how much of the device the
          tiles may hold, what raising it buys, and what it costs. */}
      <View style={[styles.infoRow, styles.budgetRow, isDark && styles.infoRowDark]}>
        <View style={styles.budgetHeader}>
          <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
            {t('settings.tileCacheLimit')}
          </Text>
          <Pressable
            testID="settings-tile-cache-limit"
            onPress={() => setPickingBudget(true)}
            style={pressable(styles.infoValueRow)}
            accessibilityRole="button"
            android_ripple={pressRipple}
          >
            <Text
              style={[
                styles.infoValue,
                styles.statLabelClickable,
                isDark && { color: darkColors.linkTeal },
              ]}
            >
              {formatFileSize(budgetBytes)} ›
            </Text>
          </Pressable>
        </View>
        <Text
          testID="settings-tile-cache-subtitle"
          style={[styles.budgetHint, isDark && styles.textMuted]}
        >
          {t('settings.tileCacheLimitHint')}
        </Text>
        <View style={[styles.budgetTrack, isDark && styles.budgetTrackDark]}>
          <View style={[styles.budgetFill, { flex: usedShare }]} />
          <View style={{ flex: 1 - usedShare }} />
        </View>
        <View style={styles.budgetFooter}>
          <Text testID="settings-tile-cache-used" style={styles.budgetFooterText}>
            {basemapTiles
              ? t('settings.tileCacheUsedOfBudget', {
                  used: formatFileSize(usedBytes),
                  budget: formatFileSize(budgetBytes),
                })
              : t('settings.tileCacheUsedOfBudgetAtLeast', {
                  used: formatFileSize(usedBytes),
                  budget: formatFileSize(budgetBytes),
                })}
          </Text>
          {freeStorage !== null && (
            <Text testID="settings-tile-cache-free" style={styles.budgetFooterText}>
              {t('settings.tileCacheFree', { size: formatFileSize(freeStorage) })}
            </Text>
          )}
        </View>
      </View>

      <Modal
        visible={pickingBudget}
        transparent
        animationType="fade"
        onRequestClose={() => setPickingBudget(false)}
      >
        <TouchableOpacity
          testID="settings-tile-cache-picker"
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPickingBudget(false)}
        >
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <Text style={[styles.modalTitle, isDark && styles.textLight]}>
              {t('settings.tileCacheLimit')}
            </Text>
            {TILE_CACHE_BUDGET_CHOICES_MB.map((mb) => {
              const selected = mb === budgetMb;
              return (
                <TouchableOpacity
                  key={mb}
                  testID={`settings-tile-cache-choice-${mb}`}
                  style={[styles.modalOption, selected && styles.modalOptionSelected]}
                  onPress={() => chooseBudget(mb)}
                  activeOpacity={0.6}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      isDark && styles.textLight,
                      selected && { color: isDark ? darkColors.linkTeal : colors.linkTeal },
                    ]}
                  >
                    {formatFileSize(mb * BYTES_PER_BUDGET_MB)}
                  </Text>
                  {selected && (
                    <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Storage breakdown bar */}
      <StorageBreakdownBar
        routesSize={routesSize}
        basemapTiles={basemapTiles}
        terrainCacheSize={terrainCacheSize}
        heatmapCacheSize={heatmapCacheSize}
        athleteFilesSize={athleteFilesSize}
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
    fontSize: typography.screenTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  statLabelClickable: {
    fontSize: typography.caption.fontSize,
    color: colors.linkTeal,
    marginTop: spacing.xxs,
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
  // The budget row is the only one that stacks: a label and its value, then
  // what raising it buys, then what it holds against what it may.
  budgetRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.xs,
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  budgetTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    backgroundColor: colors.borderLight,
  },
  budgetTrackDark: {
    backgroundColor: darkColors.border,
  },
  budgetFill: {
    backgroundColor: colors.primary,
  },
  budgetFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetFooterText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: opacity.overlay.scrim,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusLg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  modalContentDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  modalTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusMd,
    minHeight: layout.minTapTarget,
  },
  modalOptionSelected: {
    backgroundColor: colors.backgroundAlt,
  },
  modalOptionText: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  infoLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: typography.bodySmall.fontSize,
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
    paddingVertical: spacing.xxs,
  },
  clearInlineText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.linkTeal,
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
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
  },
  storageBarSegment: {
    height: '100%',
  },
  deviceUsageBar: {
    flexDirection: 'row',
    height: 4,
    borderRadius: layout.borderRadiusFull,
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
    gap: spacing.xs,
  },
  storageLegendDot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  storageLegendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
});
