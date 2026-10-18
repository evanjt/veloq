import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { Button, Stepper, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { readFeedCards } from '@/features/activity/light';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { getEngine } from '@/shared/native/engine';
import { useLastSyncSuccessAt, useTrackStage } from '@/shared/native/useSyncStatus';
import { attemptEngineRead, engineErrorKey, engineErrorTag } from '@/shared/native/engineError';
import { i18n } from '@/i18n';
import * as haptics from '@/shared/ui/haptics';
import { deleteGpsTracks } from '@/shared/storage/gpsStorage';
import { queryKeys } from '@/shared/query/queryKeys';
import { TrackStep, type PersistentEngineStats } from 'veloqrs';
import { ABSENT } from '@/shared/format/absent';
import { confirmAction, inform } from '@/shared/ui/dialog';

const FORCE_SYNC_LABEL = 'Force Sync';
const HARD_RESYNC_LABEL = 'Hard Re-sync';
const REMOVE_COUNT_LABEL = 'Remove Activities';
// A count of activities, one per press.
const COUNT_SCALE = { perStored: 1, step: 1 };

// ============================================================================
// Reusable UI (matches debug.tsx patterns)
// ============================================================================

function StatRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, isDark && styles.textSecondary]}>{label}</Text>
      <Text style={[styles.statValue, isDark && styles.textLight]}>{value}</Text>
    </View>
  );
}

function Section({
  title,
  icon,
  isDark,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  isDark: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <PressTarget
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.sectionHeaderLeft}>
          <Icon name={icon} size={iconSize.md} color={mutedColor} />
          <Text style={[styles.sectionTitle, { color: textColor }]}>{title}</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={iconSize.md} color={mutedColor} />
      </PressTarget>
      {open ? <View style={styles.sectionContent}>{children}</View> : null}
    </View>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SyncDebugSection() {
  const { isDark } = useTheme();
  const queryClient = useQueryClient();

  // A new reader on every activities announcement, which re-runs both reads.
  const readActivities = useEngineRead(['activities']);

  // Data sources
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const trackStage = useTrackStage();
  const lastSyncSuccessAt = useLastSyncSuccessAt();

  // The feed cards over the sync window, read only while this debug tab is open
  const apiActivities = useMemo(
    () => readActivities(() => readFeedCards(syncOldest, syncNewest)) ?? [],
    [readActivities, syncOldest, syncNewest]
  );

  const engine = getEngine();
  const engineActivityIds = useMemo(
    () => readActivities((client) => client.getActivityIds()) ?? [],
    [readActivities]
  );

  const engineStatsRead = useMemo(
    () =>
      attemptEngineRead((): PersistentEngineStats | undefined =>
        readActivities((client) => client.getStats())
      ),
    [readActivities]
  );
  const engineStats = engineStatsRead.value;

  // Alignment computation
  const alignment = useMemo(() => {
    const apiIds = new Set(apiActivities.map((a) => a.id));
    const engineIds = new Set(engineActivityIds);
    const aligned = [...apiIds].filter((id) => engineIds.has(id));
    const missingFromEngine = [...apiIds].filter((id) => !engineIds.has(id));
    const extraInEngine = [...engineIds].filter((id) => !apiIds.has(id));

    return {
      apiCount: apiIds.size,
      engineCount: engineIds.size,
      alignedCount: aligned.length,
      missingFromEngine,
      extraInEngine,
    };
  }, [apiActivities, engineActivityIds]);

  // Traffic light color
  const alignmentColor = useMemo(() => {
    if (alignment.apiCount === 0 && alignment.engineCount === 0) return colors.iconSecondary;
    if (alignment.missingFromEngine.length === 0 && alignment.extraInEngine.length === 0) {
      return colors.successText;
    }
    if (alignment.missingFromEngine.length <= 3) return colors.warningText;
    return colors.errorText;
  }, [alignment]);

  // State for "Remove N Activities" stepper
  const [removeCount, setRemoveCount] = useState(3);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [forceSyncStatus, setForceSyncStatus] = useState('');

  // Force sync handler
  const handleForceSync = useCallback(() => {
    const missing = alignment.missingFromEngine.length;
    if (missing > 0) {
      setForceSyncStatus(`${missing} activities missing - sync triggered`);
      inform({
        title: 'Force Sync',
        message: `${missing} activities missing from engine - sync triggered.\n\nWatch Sync Status section for progress.`,
      });
    } else {
      setForceSyncStatus('All activities already synced');
      inform({ title: 'Force Sync', message: 'All activities already synced - nothing to fetch.' });
    }
    // Invalidate cache to fetch fresh activity list from API
    queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    // Fire syncReset to force useRouteDataSync to re-check engine state
    // (invalidateQueries alone won't trigger re-sync if API returns same data)
    engine?.triggerRefresh('syncReset');
  }, [queryClient, engine, alignment.missingFromEngine.length]);

  // Remove N activities handler
  const handleRemoveActivities = useCallback(() => {
    if (apiActivities.length === 0 || !engine) return;

    const sorted = [...apiActivities].sort(
      (a, b) => new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
    );
    const toRemove = sorted.slice(0, removeCount).map((a) => a.id);

    confirmAction({
      title: 'Remove Activities',
      message: `Remove ${toRemove.length} most recent activities from engine?\n\nIDs: ${toRemove.join(', ')}`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      destructive: true,
      onConfirm: async () => {
        haptics.medium();
        setIsRemoving(true);
        let removed = 0;
        const removedIds: string[] = [];
        const refused: string[] = [];
        for (const id of toRemove) {
          const result = engine.removeActivity(id);
          if (result.ok) {
            removed++;
            removedIds.push(id);
          } else {
            refused.push(`${id}: ${result.reason}`);
          }
        }
        // Clean up orphaned GPS track files
        if (removedIds.length > 0) {
          await deleteGpsTracks(removedIds);
        }
        setIsRemoving(false);
        if (removed === 0 && toRemove.length > 0) {
          inform({
            title: 'Remove Failed',
            message: `No activities were removed.\n\n${refused.join('\n')}`,
          });
        } else {
          // Trigger background section detection to recompute groups + sections
          engine.startSectionDetection();
          // Invalidate cache + fire syncReset to trigger re-sync of removed activities
          queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
          engine.triggerRefresh('syncReset');
          const refusalNote = refused.length > 0 ? `\n\nKept:\n${refused.join('\n')}` : '';
          inform({
            title: 'Done',
            message: `Removed ${removed}/${toRemove.length} activities. Re-sync triggered.\n\nWatch Sync Status section for progress.${refusalNote}`,
          });
        }
      },
    });
  }, [apiActivities, engine, removeCount, queryClient]);

  // Hard re-sync handler
  const handleHardResync = useCallback(() => {
    if (!engine) return;
    confirmAction({
      title: 'Hard Re-sync',
      message:
        'This will clear ALL engine data (activities, routes, sections) and trigger a full re-sync from scratch.\n\nThis is destructive and cannot be undone.',
      confirmLabel: 'Clear & Re-sync',
      cancelLabel: 'Cancel',
      destructive: true,
      onConfirm: () => {
        haptics.medium();
        void engine.clear().then(
          () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
            inform({ title: 'Done', message: 'Engine cleared. Full re-sync triggered.' });
          },
          (error: unknown) => {
            inform({
              title: i18n.t('alerts.clearFailedTitle'),
              message: i18n.t(engineErrorKey(error, 'alerts.failedToClear')),
            });
          }
        );
      },
    });
  }, [engine, queryClient]);

  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  function formatDate(ts: number | null | undefined): string {
    if (ts == null) return ABSENT;
    return new Date(Number(ts) * 1000).toLocaleDateString();
  }

  return (
    <View testID="debug-sync-section">
      {/* Alignment */}
      <Section title="Alignment" icon="swap-horizontal" isDark={isDark}>
        <View style={styles.trafficLight}>
          <View style={[styles.trafficDot, { backgroundColor: alignmentColor }]} />
          <Text style={[styles.trafficText, isDark && styles.textLight]}>
            {alignment.missingFromEngine.length === 0 && alignment.extraInEngine.length === 0
              ? 'Aligned'
              : `${alignment.missingFromEngine.length} missing, ${alignment.extraInEngine.length} extra`}
          </Text>
        </View>
        <StatRow label="API Activities" value={String(alignment.apiCount)} isDark={isDark} />
        <StatRow label="Engine Activities" value={String(alignment.engineCount)} isDark={isDark} />
        <StatRow label="Aligned" value={String(alignment.alignedCount)} isDark={isDark} />

        {alignment.missingFromEngine.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            style={styles.expandButton}
            onPress={() => setShowMissing(!showMissing)}
            icon={showMissing ? 'chevron-up' : 'chevron-down'}
            label={`${showMissing ? 'Hide' : 'Show'} missing IDs (${alignment.missingFromEngine.length})`}
          />
        )}
        {showMissing ? (
          <View style={styles.idList}>
            {alignment.missingFromEngine.slice(0, 20).map((id) => (
              <Text key={id} style={[styles.idText, { color: mutedColor }]}>
                {id}
              </Text>
            ))}
            {alignment.missingFromEngine.length > 20 && (
              <Text style={[styles.idText, { color: mutedColor }]}>
                and {alignment.missingFromEngine.length - 20} more
              </Text>
            )}
          </View>
        ) : null}

        {alignment.extraInEngine.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            style={styles.expandButton}
            onPress={() => setShowExtra(!showExtra)}
            icon={showExtra ? 'chevron-up' : 'chevron-down'}
            label={`${showExtra ? 'Hide' : 'Show'} extra IDs (${alignment.extraInEngine.length})`}
          />
        )}
        {showExtra ? (
          <View style={styles.idList}>
            {alignment.extraInEngine.slice(0, 20).map((id) => (
              <Text key={id} style={[styles.idText, { color: mutedColor }]}>
                {id}
              </Text>
            ))}
            {alignment.extraInEngine.length > 20 && (
              <Text style={[styles.idText, { color: mutedColor }]}>
                and {alignment.extraInEngine.length - 20} more
              </Text>
            )}
          </View>
        ) : null}
      </Section>

      {/* Engine Stats */}
      <Section title="Engine Stats" icon="database" isDark={isDark}>
        {engineStats ? (
          <>
            <StatRow label="Activities" value={String(engineStats.activityCount)} isDark={isDark} />
            <StatRow label="GPS Tracks" value={String(engineStats.gpsTrackCount)} isDark={isDark} />
            <StatRow label="Groups" value={String(engineStats.groupCount)} isDark={isDark} />
            <StatRow label="Sections" value={String(engineStats.sectionCount)} isDark={isDark} />
            <StatRow
              label="Groups Dirty"
              value={engineStats.groupsDirty ? 'Yes' : 'No'}
              isDark={isDark}
            />
            <StatRow
              label="Sections Dirty"
              value={engineStats.sectionsDirty ? 'Yes' : 'No'}
              isDark={isDark}
            />
            <StatRow
              label="Sig Cache"
              value={`${engineStats.signatureCacheSize}/200`}
              isDark={isDark}
            />
            <StatRow
              label="Date Range"
              value={`${formatDate(engineStats.oldestDate ?? null)} - ${formatDate(engineStats.newestDate ?? null)}`}
              isDark={isDark}
            />
          </>
        ) : !engineStatsRead.ok ? (
          <Text style={[styles.emptyText, { color: mutedColor }]}>
            {`Could not read engine stats: ${engineErrorTag(engineStatsRead.error) ?? String(engineStatsRead.error)}`}
          </Text>
        ) : (
          <Text style={[styles.emptyText, { color: mutedColor }]}>Engine not initialised</Text>
        )}
      </Section>

      {/* Sync Status */}
      <Section title="Sync Status" icon="sync" isDark={isDark}>
        <StatRow
          label="Track Stage"
          value={trackStage ? TrackStep[trackStage.step] : 'Idle'}
          isDark={isDark}
        />
        <StatRow
          label="Progress"
          value={
            trackStage && trackStage.total > 0
              ? `${trackStage.completed}/${trackStage.total} (${trackStage.percent}%)`
              : ABSENT
          }
          isDark={isDark}
        />
        <StatRow label="Last Sync" value={lastSyncSuccessAt ?? 'Never'} isDark={isDark} />
        <StatRow label="Sync Range" value={`${syncOldest} - ${syncNewest}`} isDark={isDark} />
      </Section>

      {/* Actions */}
      <Section title="Actions" icon="wrench" isDark={isDark}>
        <Button
          variant="secondary"
          style={styles.actionButton}
          onPress={handleForceSync}
          icon="refresh"
          label={FORCE_SYNC_LABEL}
        />
        {forceSyncStatus !== '' && (
          <Text style={[styles.statusText, { color: mutedColor }]}>{forceSyncStatus}</Text>
        )}

        <View style={styles.removeSection}>
          <View style={styles.stepperRow}>
            <Text style={[styles.stepperLabel, isDark && styles.textLight]}>
              {REMOVE_COUNT_LABEL}
            </Text>
            <Stepper
              testID="sync-debug-remove-count"
              accessibilityLabel={REMOVE_COUNT_LABEL}
              decrementLabel={i18n.t('stats.fewerActivities')}
              incrementLabel={i18n.t('stats.moreActivities')}
              value={removeCount}
              min={1}
              max={50}
              scale={COUNT_SCALE}
              format={String}
              onChange={setRemoveCount}
            />
          </View>
          <Button
            variant="destructive"
            opensConfirm
            onPress={handleRemoveActivities}
            disabled={isRemoving || apiActivities.length === 0}
            icon={{ chrome: 'delete' }}
            label={isRemoving ? 'Removing...' : `Remove ${removeCount} & Re-sync`}
          />
        </View>

        <View style={styles.hardResyncSection}>
          <Button
            variant="destructive"
            opensConfirm
            onPress={handleHardResync}
            disabled={!engine}
            icon="nuke"
            label={HARD_RESYNC_LABEL}
          />
          <Text style={[styles.hintText, { color: mutedColor }]}>
            Clears all engine data and triggers a full re-sync from scratch.
          </Text>
        </View>
      </Section>
    </View>
  );
}

// ============================================================================
// Styles (matching debug.tsx patterns)
// ============================================================================

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.bodyBold,
  },
  sectionContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  statLabel: {
    fontSize: typography.bodyCompact.fontSize,
    fontFamily: typography.code.fontFamily,
    color: colors.textSecondary,
  },
  statValue: {
    ...typography.bodyCompactBold,
    fontFamily: typography.code.fontFamily,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  emptyText: {
    ...typography.bodyCompact,
  },
  trafficLight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  trafficDot: {
    width: 12,
    height: 12,
    borderRadius: layout.borderRadiusFull,
  },
  trafficText: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
  },
  expandButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  idList: {
    marginTop: spacing.xs,
    paddingLeft: spacing.sm,
  },
  idText: {
    fontSize: typography.label.fontSize,
    fontFamily: typography.code.fontFamily,
    lineHeight: 18,
  },
  actionButton: {
    marginBottom: spacing.sm,
  },
  statusText: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.code.fontFamily,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  removeSection: {
    marginTop: spacing.xs,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  stepperLabel: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
  },
  hardResyncSection: {
    marginTop: spacing.md,
  },
  hintText: {
    ...typography.caption,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});
