import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors, darkColors, spacing } from '@/theme';
import { useTheme } from '@/hooks';
import { useActivities, useEngineSubscription } from '@/hooks';
import { useSyncDateRange } from '@/providers';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { PersistentEngineStats } from 'veloqrs';

// ============================================================================
// Reusable UI (matches debug.tsx patterns)
// ============================================================================

function StatRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, isDark && styles.textMuted]}>{label}</Text>
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
  icon: string;
  isDark: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <MaterialCommunityIcons name={icon as any} size={20} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: textColor }]}>{title}</Text>
        </View>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={mutedColor}
        />
      </TouchableOpacity>
      {open && <View style={styles.sectionContent}>{children}</View>}
    </View>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SyncDebugTab() {
  const { isDark } = useTheme();
  const queryClient = useQueryClient();

  // Subscribe to engine activity changes
  const trigger = useEngineSubscription(['activities']);

  // Data sources
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const lastSyncTimestamp = useSyncDateRange((s) => s.lastSyncTimestamp);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);

  // API activities (shares cache with GlobalDataSync)
  const { data: apiActivities } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
  });

  // Engine data (refreshes on subscription trigger)
  const engine = getRouteEngine();
  const engineActivityIds = useMemo(() => {
    return engine?.getActivityIds() ?? [];
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const engineStats: PersistentEngineStats | undefined = useMemo(() => {
    return engine?.getStats();
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alignment computation
  const alignment = useMemo(() => {
    const apiIds = new Set(apiActivities?.map((a) => a.id) ?? []);
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
    if (alignment.apiCount === 0 && alignment.engineCount === 0) return '#9ca3af'; // gray
    if (alignment.missingFromEngine.length === 0 && alignment.extraInEngine.length === 0) {
      return '#22c55e'; // green
    }
    if (alignment.missingFromEngine.length <= 3) return '#f59e0b'; // yellow
    return '#ef4444'; // red
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
      setForceSyncStatus(`${missing} activities missing — sync triggered`);
      Alert.alert(
        'Force Sync',
        `${missing} activities missing from engine — sync triggered.\n\nWatch Sync Status section for progress.`
      );
    } else {
      setForceSyncStatus('All activities already synced');
      Alert.alert('Force Sync', 'All activities already synced — nothing to fetch.');
    }
    // Invalidate cache to fetch fresh activity list from API
    queryClient.invalidateQueries({ queryKey: ['activities'] });
    // Fire syncReset to force useRouteDataSync to re-check engine state
    // (invalidateQueries alone won't trigger re-sync if API returns same data)
    engine?.triggerRefresh('syncReset');
  }, [queryClient, engine, alignment.missingFromEngine.length]);

  // Remove N activities handler
  const handleRemoveActivities = useCallback(() => {
    if (!apiActivities || apiActivities.length === 0 || !engine) return;

    const sorted = [...apiActivities].sort(
      (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
    );
    const toRemove = sorted.slice(0, removeCount).map((a) => a.id);

    Alert.alert(
      'Remove Activities',
      `Remove ${toRemove.length} most recent activities from engine?\n\nIDs: ${toRemove.join(', ')}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setIsRemoving(true);
            let removed = 0;
            for (const id of toRemove) {
              if (engine.removeActivity(id)) removed++;
            }
            setIsRemoving(false);
            if (removed === 0 && toRemove.length > 0) {
              Alert.alert(
                'Remove Failed',
                'No activities were removed. The FFI bindings may be stale.\n\nRun: ./scripts/generate-bindings.sh && npx expo run:android'
              );
            } else {
              // Trigger background section detection to recompute groups + sections
              engine.startSectionDetection();
              // Invalidate cache + fire syncReset to trigger re-sync of removed activities
              queryClient.invalidateQueries({ queryKey: ['activities'] });
              engine.triggerRefresh('syncReset');
              Alert.alert(
                'Done',
                `Removed ${removed}/${toRemove.length} activities. Re-sync triggered.\n\nWatch Sync Status section for progress.`
              );
            }
          },
        },
      ]
    );
  }, [apiActivities, engine, removeCount, queryClient]);

  // Hard re-sync handler
  const handleHardResync = useCallback(() => {
    if (!engine) return;
    Alert.alert(
      'Hard Re-sync',
      'This will clear ALL engine data (activities, routes, sections) and trigger a full re-sync from scratch.\n\nThis is destructive and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear & Re-sync',
          style: 'destructive',
          onPress: () => {
            engine.clear();
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            Alert.alert('Done', 'Engine cleared. Full re-sync triggered.');
          },
        },
      ]
    );
  }, [engine, queryClient]);

  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  function formatDate(ts: number | bigint | null | undefined): string {
    if (ts == null) return '-';
    return new Date(Number(ts) * 1000).toLocaleDateString();
  }

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
    >
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
          <TouchableOpacity
            style={styles.expandButton}
            onPress={() => setShowMissing(!showMissing)}
            activeOpacity={0.7}
          >
            <Text style={[styles.expandText, { color: colors.primary }]}>
              {showMissing ? 'Hide' : 'Show'} missing IDs ({alignment.missingFromEngine.length})
            </Text>
            <MaterialCommunityIcons
              name={showMissing ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </TouchableOpacity>
        )}
        {showMissing && (
          <View style={styles.idList}>
            {alignment.missingFromEngine.slice(0, 20).map((id) => (
              <Text key={id} style={[styles.idText, { color: mutedColor }]}>
                {id}
              </Text>
            ))}
            {alignment.missingFromEngine.length > 20 && (
              <Text style={[styles.idText, { color: mutedColor, fontStyle: 'italic' }]}>
                and {alignment.missingFromEngine.length - 20} more
              </Text>
            )}
          </View>
        )}

        {alignment.extraInEngine.length > 0 && (
          <TouchableOpacity
            style={styles.expandButton}
            onPress={() => setShowExtra(!showExtra)}
            activeOpacity={0.7}
          >
            <Text style={[styles.expandText, { color: colors.primary }]}>
              {showExtra ? 'Hide' : 'Show'} extra IDs ({alignment.extraInEngine.length})
            </Text>
            <MaterialCommunityIcons
              name={showExtra ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </TouchableOpacity>
        )}
        {showExtra && (
          <View style={styles.idList}>
            {alignment.extraInEngine.slice(0, 20).map((id) => (
              <Text key={id} style={[styles.idText, { color: mutedColor }]}>
                {id}
              </Text>
            ))}
            {alignment.extraInEngine.length > 20 && (
              <Text style={[styles.idText, { color: mutedColor, fontStyle: 'italic' }]}>
                and {alignment.extraInEngine.length - 20} more
              </Text>
            )}
          </View>
        )}
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
              label="Consensus Cache"
              value={`${engineStats.consensusCacheSize}/50`}
              isDark={isDark}
            />
            <StatRow
              label="Date Range"
              value={`${formatDate(engineStats.oldestDate ?? null)} - ${formatDate(engineStats.newestDate ?? null)}`}
              isDark={isDark}
            />
          </>
        ) : (
          <Text style={[styles.emptyText, { color: mutedColor }]}>Engine not initialized</Text>
        )}
      </Section>

      {/* Sync Status */}
      <Section title="Sync Status" icon="sync" isDark={isDark}>
        <StatRow label="Status" value={gpsSyncProgress.status} isDark={isDark} />
        <StatRow
          label="Progress"
          value={
            gpsSyncProgress.total > 0
              ? `${gpsSyncProgress.completed}/${gpsSyncProgress.total} (${gpsSyncProgress.percent}%)`
              : '-'
          }
          isDark={isDark}
        />
        {gpsSyncProgress.message ? (
          <StatRow label="Message" value={gpsSyncProgress.message} isDark={isDark} />
        ) : null}
        <StatRow label="Last Sync" value={lastSyncTimestamp ?? 'Never'} isDark={isDark} />
        <StatRow label="Syncing" value={isGpsSyncing ? 'Yes' : 'No'} isDark={isDark} />
        <StatRow label="Sync Range" value={`${syncOldest} - ${syncNewest}`} isDark={isDark} />
      </Section>

      {/* Actions */}
      <Section title="Actions" icon="wrench" isDark={isDark}>
        <TouchableOpacity
          style={[styles.actionButton, isDark && styles.actionButtonDark]}
          onPress={handleForceSync}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
          <Text style={[styles.actionButtonText, { color: colors.primary }]}>Force Sync</Text>
        </TouchableOpacity>
        {forceSyncStatus !== '' && (
          <Text style={[styles.statusText, { color: mutedColor }]}>{forceSyncStatus}</Text>
        )}

        <View style={styles.removeSection}>
          <View style={styles.stepperRow}>
            <Text style={[styles.stepperLabel, isDark && styles.textLight]}>
              Remove Activities:
            </Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, isDark && styles.stepperBtnDark]}
                onPress={() => setRemoveCount(Math.max(1, removeCount - 1))}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="minus"
                  size={16}
                  color={isDark ? darkColors.textPrimary : colors.textPrimary}
                />
              </TouchableOpacity>
              <Text style={[styles.stepperValue, isDark && styles.textLight]}>{removeCount}</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, isDark && styles.stepperBtnDark]}
                onPress={() => setRemoveCount(Math.min(50, removeCount + 1))}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="plus"
                  size={16}
                  color={isDark ? darkColors.textPrimary : colors.textPrimary}
                />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.dangerButton, isRemoving && styles.dangerButtonDisabled]}
            onPress={handleRemoveActivities}
            activeOpacity={0.7}
            disabled={isRemoving || !apiActivities?.length}
          >
            <MaterialCommunityIcons name="delete-outline" size={18} color="#fff" />
            <Text style={styles.dangerButtonText}>
              {isRemoving ? 'Removing...' : `Remove ${removeCount} & Re-sync`}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hardResyncSection}>
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={handleHardResync}
            activeOpacity={0.7}
            disabled={!engine}
          >
            <MaterialCommunityIcons name="nuke" size={18} color="#fff" />
            <Text style={styles.dangerButtonText}>Hard Re-sync</Text>
          </TouchableOpacity>
          <Text style={[styles.hintText, { color: mutedColor }]}>
            Clears all engine data and triggers a full re-sync from scratch.
          </Text>
        </View>
      </Section>

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

// ============================================================================
// Styles (matching debug.tsx patterns)
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceElevated,
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
    fontSize: 16,
    fontWeight: '600',
  },
  sectionContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  statLabel: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: colors.textPrimary,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  emptyText: {
    fontSize: 13,
    fontStyle: 'italic',
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
    borderRadius: 6,
  },
  trafficText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    paddingVertical: 4,
  },
  expandText: {
    fontSize: 13,
    fontWeight: '500',
  },
  idList: {
    marginTop: 4,
    paddingLeft: spacing.sm,
  },
  idText: {
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  actionButtonDark: {
    backgroundColor: darkColors.background,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 12,
    fontFamily: 'monospace',
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
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDark: {
    backgroundColor: darkColors.background,
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: colors.textPrimary,
    minWidth: 28,
    textAlign: 'center',
  },
  hardResyncSection: {
    marginTop: spacing.md,
  },
  hintText: {
    fontSize: 12,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ef4444',
    borderRadius: 8,
  },
  dangerButtonDisabled: {
    opacity: 0.5,
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
