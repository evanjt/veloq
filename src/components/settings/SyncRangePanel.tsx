import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TimelineSlider } from '@/components/maps';
import { useActivityBoundsCache, useOldestActivityDate, useTheme } from '@/hooks';
import { formatLocalDate } from '@/lib';
import { useSyncDateRange, useRouteSettings } from '@/providers';
import { applyDetectionStrictness, getRouteEngine } from '@/lib/native/routeEngine';
import { useSectionRescan } from '@/hooks/routes/useSectionRescan';
import { settingsStyles } from './settingsStyles';
import { colors, darkColors, spacing } from '@/theme';

const PRESETS = [
  { key: 'detectionRelaxed', value: 20, matchPct: 55, endpoint: 270 },
  { key: 'default', value: 60, matchPct: 65, endpoint: 210 },
  { key: 'detectionStrict', value: 90, matchPct: 72.5, endpoint: 165 },
] as const;

export function SyncRangePanel() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // --- Data range state ---
  const { progress, cacheStats, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);

  const cachedStartDate = useMemo(() => {
    if (isExpansionLocked) return new Date(syncOldest);
    if (cacheStats.oldestDate) {
      const cacheOldest = new Date(cacheStats.oldestDate);
      const syncStart = new Date(syncOldest);
      return cacheOldest < syncStart ? cacheOldest : syncStart;
    }
    return new Date(syncOldest);
  }, [cacheStats.oldestDate, syncOldest, isExpansionLocked]);

  const cachedEndDate = useMemo(() => new Date(), []);

  const isSyncing = progress.status === 'syncing' || isGpsSyncing || isFetchingExtended;

  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();
    if (apiOldestDate) {
      return { minDateForSlider: new Date(apiOldestDate), maxDateForSlider: now };
    }
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return { minDateForSlider: d, maxDateForSlider: now };
  }, [apiOldestDate]);

  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      if (start < cachedStartDate) {
        syncDateRange(formatLocalDate(start), formatLocalDate(new Date()));
      }
    },
    [syncDateRange, cachedStartDate]
  );

  // --- Detection sensitivity state ---
  const { settings, setDetectionStrictness } = useRouteSettings();
  const [pruneResult, setPruneResult] = useState<number | null>(null);

  const activePresetIndex = useMemo(() => {
    let closest = 0;
    let closestDist = Math.abs(PRESETS[0].value - settings.detectionStrictness);
    for (let i = 1; i < PRESETS.length; i++) {
      const dist = Math.abs(PRESETS[i].value - settings.detectionStrictness);
      if (dist < closestDist) {
        closest = i;
        closestDist = dist;
      }
    }
    return closest;
  }, [settings.detectionStrictness]);

  useEffect(() => {
    if (pruneResult === null) return;
    const timer = setTimeout(() => setPruneResult(null), 3000);
    return () => clearTimeout(timer);
  }, [pruneResult]);

  const handlePresetSelect = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      setDetectionStrictness(preset.value);
      applyDetectionStrictness(preset.value);
    },
    [setDetectionStrictness]
  );

  // --- Section rescan state ---
  const { forceRescan, isScanning, progress: rescanProgress } = useSectionRescan();

  const handleReanalyze = useCallback(() => {
    Alert.alert(t('settings.reanalyzeSections'), t('settings.reanalyzeWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: () => forceRescan() },
    ]);
  }, [t, forceRescan]);

  const handlePrune = useCallback(() => {
    const count = getRouteEngine()?.pruneOverlappingSections() ?? 0;
    setPruneResult(count);
  }, []);

  const rescanPercent =
    rescanProgress && rescanProgress.total > 0
      ? Math.max((rescanProgress.completed / rescanProgress.total) * 100, 2)
      : 2;

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.localDataRange').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {/* Timeline slider */}
        <View style={styles.sliderWrap}>
          <TimelineSlider
            minDate={minDateForSlider}
            maxDate={maxDateForSlider}
            startDate={cachedStartDate}
            endDate={cachedEndDate}
            onRangeChange={handleRangeChange}
            isLoading={isSyncing}
            activityCount={cacheStats.totalActivities}
            cachedOldest={null}
            cachedNewest={null}
            isDark={isDark}
            showActivityFilter={false}
            showCachedRange={false}
            showLegend={false}
            showSyncBanner={false}
            fixedEnd
            expandOnly
          />
        </View>

        {/* GPS sync progress */}
        {isSyncing || isFetchingExtended ? (
          <View style={[styles.progressRow, isDark && styles.progressRowDark]}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.max(gpsSyncProgress.percent, 2)}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {gpsSyncProgress.message ||
                (isFetchingExtended
                  ? t('cache.fetchingActivities', 'Fetching activities...')
                  : t('common.loading'))}
              {gpsSyncProgress.total > 0 &&
                ` (${gpsSyncProgress.completed}/${gpsSyncProgress.total})`}
            </Text>
          </View>
        ) : null}

        {/* Detection sensitivity */}
        <View style={[settingsStyles.fullDivider, isDark && settingsStyles.fullDividerDark]} />

        <View style={styles.detectionRow}>
          <MaterialCommunityIcons
            name="tune-variant"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={{ flex: 1 }}>
            <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
              {t('settings.detectionSensitivity')}
            </Text>

            {/* Segmented bar */}
            <View
              style={[styles.segmentedBar, { backgroundColor: isDark ? '#27272A' : '#E4E4E7' }]}
            >
              <View
                style={[
                  styles.segmentedFill,
                  { width: `${((activePresetIndex + 1) / PRESETS.length) * 100}%` },
                ]}
              />
              {PRESETS.map((p, i) => {
                const isActive = i <= activePresetIndex;
                const isSelected = i === activePresetIndex;
                const label = p.key === 'default' ? t('settings.default') : t(`settings.${p.key}`);
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={styles.segmentedItem}
                    onPress={() => handlePresetSelect(p)}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: isSelected ? '600' : '400',
                        color: isActive
                          ? colors.primary
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary,
                      }}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text
              style={{
                fontSize: 11,
                color: isDark ? darkColors.textDisabled : colors.textDisabled,
                marginTop: 4,
              }}
            >
              {t('settings.matchThreshold', { pct: PRESETS[activePresetIndex].matchPct })}
              {'  '}
              {t('settings.endpointDistance', { meters: PRESETS[activePresetIndex].endpoint })}
            </Text>
          </View>
        </View>

        {/* Reanalyse sections */}
        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        <TouchableOpacity
          style={[settingsStyles.actionRow, isScanning && styles.actionRowDisabled]}
          onPress={isScanning ? undefined : handleReanalyze}
          disabled={isScanning}
          activeOpacity={isScanning ? 1 : 0.2}
        >
          {isScanning ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
          ) : (
            <MaterialCommunityIcons
              name="refresh"
              size={22}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          )}
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.reanalyzeSections')}
          </Text>
        </TouchableOpacity>

        {/* Rescan progress */}
        {isScanning && rescanProgress ? (
          <View style={[styles.progressRow, isDark && styles.progressRowDark]}>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${rescanPercent}%` }]} />
            </View>
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {rescanProgress.phase}
              {rescanProgress.total > 0
                ? ` (${rescanProgress.completed}/${rescanProgress.total})`
                : ''}
            </Text>
          </View>
        ) : null}

        {/* Cleanup overlapping */}
        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        <TouchableOpacity style={settingsStyles.actionRow} onPress={handlePrune}>
          <MaterialCommunityIcons
            name="set-merge"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.cleanupOverlapping')}
          </Text>
          {pruneResult !== null && (
            <Text
              style={{
                fontSize: 12,
                color: isDark ? darkColors.textSecondary : colors.textSecondary,
              }}
            >
              {t('settings.cleanupResult', { count: pruneResult })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sliderWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  progressRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(252, 76, 2, 0.06)',
  },
  progressRowDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
  detectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  segmentedBar: {
    flexDirection: 'row',
    height: 36,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  segmentedFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(252, 76, 2, 0.12)',
    borderRadius: 8,
  },
  segmentedItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  spinner: {
    width: 22,
    height: 22,
  },
});
