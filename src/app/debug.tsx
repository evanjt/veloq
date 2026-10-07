import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
  Share,
} from 'react-native';
import Constants from 'expo-constants';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import {
  readBasemapTileCounts,
  readSnapshotQueueReport,
  resetBasemapTileCounts,
} from '@/features/maps';
import { getFFIMetricsSummary, clearFFIMetrics } from '@/shared/debug/renderTimer';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';
import { hermesStats } from '@/shared/debug/hermesStats';
import { useSupportStore, daysSince } from '@/shared/app/SupportStore';
import { formatLocalDate } from '@/shared/format/format';
import { readTaskRuns, clearTaskRuns, type TaskRunEntry } from '@/features/insights';
import type { FfiPushRun, PersistentEngineStats } from 'veloqrs';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { attemptEngineRead, engineErrorTag } from '@/shared/native/engineError';

function getEngine() {
  try {
    const mod = require('veloqrs');
    return mod.EngineClient?.getInstance() ?? null;
  } catch {
    return null;
  }
}

function getMemoryStats(): { heapMB: string; allocMB: string; gcCount: number } | null {
  const stats = hermesStats();
  if (!stats) return null;
  return {
    heapMB: (stats['js_heapSize'] / 1024 / 1024).toFixed(1),
    allocMB: (stats['js_totalAllocatedBytes'] / 1024 / 1024).toFixed(1),
    gcCount: stats['js_numGCs'] ?? 0,
  };
}

function formatDate(ts: number | null | undefined): string {
  if (ts == null) return '-';
  return new Date(Number(ts) * 1000).toLocaleDateString();
}

interface CollapsibleSectionProps {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  isDark: boolean;
  defaultOpen?: boolean;
  testID?: string;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  icon,
  isDark,
  defaultOpen = true,
  testID,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <TouchableOpacity
        testID={testID}
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
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

interface StatRowProps {
  label: string;
  value: string;
  isDark: boolean;
}

function StatRow({ label, value, isDark }: StatRowProps) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, isDark && styles.textMuted]}>{label}</Text>
      <Text style={[styles.statValue, isDark && styles.textLight]}>{value}</Text>
    </View>
  );
}

function getAvgColor(avgMs: number): string {
  if (avgMs > 100) return colors.error;
  if (avgMs > 50) return colors.warning;
  return colors.success;
}

function daysAgoLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}

function SupportCardDebug({ isDark }: { isDark: boolean }) {
  const lastActionDate = useSupportStore((s) => s.lastActionDate);
  const permanentlyDismissed = useSupportStore((s) => s.permanentlyDismissed);
  const isLegacyPurchaser = useSupportStore((s) => s.isLegacyPurchaser);
  const debugOverride = useSupportStore((s) => s._debugOverride);

  const daysUntilShow =
    lastActionDate != null ? Math.max(0, Math.ceil(30 - daysSince(lastActionDate))) : 0;

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  const presets = [
    { label: '0d ago', days: 0 },
    { label: '29d ago', days: 29 },
    { label: '31d ago', days: 31 },
  ];

  return (
    <CollapsibleSection
      title="Support Card"
      icon="heart-outline"
      isDark={isDark}
      defaultOpen={false}
      testID="debug-section-support-card"
    >
      <StatRow label="Last shown" value={lastActionDate ?? 'never'} isDark={isDark} />
      <StatRow label="Days until next" value={String(daysUntilShow)} isDark={isDark} />
      <StatRow label="Dismissed" value={permanentlyDismissed ? 'Yes' : 'No'} isDark={isDark} />
      <StatRow label="Legacy purchaser" value={isLegacyPurchaser ? 'Yes' : 'No'} isDark={isDark} />

      <Text
        style={[
          {
            fontSize: typography.caption.fontSize,
            marginTop: spacing.sm,
            marginBottom: spacing.xs,
          },
          { color: mutedColor },
        ]}
      >
        Set last shown:
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {presets.map((p) => (
          <TouchableOpacity
            key={p.days}
            testID={`debug-support-preset-${p.days}d`}
            onPress={() =>
              debugOverride({
                lastActionDate: daysAgoLocal(p.days),
                permanentlyDismissed: false,
                dismissCount: 0,
              })
            }
            style={[styles.actionButton, { paddingHorizontal: spacing.sm }]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.actionButtonText,
                { color: isDark ? darkColors.linkTeal : colors.linkTeal },
              ]}
            >
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <TouchableOpacity
          onPress={() =>
            debugOverride({
              lastActionDate: daysAgoLocal(31),
              permanentlyDismissed: false,
            })
          }
          style={styles.actionButton}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.actionButtonText,
              { color: isDark ? darkColors.linkTeal : colors.linkTeal },
            ]}
          >
            Clear dismissed
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="debug-support-legacy-toggle"
          onPress={() => debugOverride({ isLegacyPurchaser: !isLegacyPurchaser })}
          style={styles.actionButton}
          activeOpacity={0.7}
        >
          <Text style={[styles.actionButtonText, { color: textColor }]}>
            {isLegacyPurchaser ? 'Unset' : 'Set'} legacy
          </Text>
        </TouchableOpacity>
      </View>
    </CollapsibleSection>
  );
}

function BackgroundNotificationsDebug({
  isDark,
  refreshKey,
}: {
  isDark: boolean;
  refreshKey: number;
}) {
  const [runs, setRuns] = useState<TaskRunEntry[]>([]);
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;

  // The native worker's own runs. It has no JavaScript in its process, so it
  // writes them to the engine and nothing of it reaches the ring above.
  const pushRunsRead = useMemo(
    () => attemptEngineRead((): FfiPushRun[] => getEngine()?.pushRuns() ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refresh reads the worker runs on demand.
    [refreshKey]
  );
  const pushRuns = pushRunsRead.value ?? [];

  useEffect(() => {
    let cancelled = false;
    readTaskRuns().then((entries) => {
      if (!cancelled) setRuns(entries.slice().reverse());
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleClear = useCallback(() => {
    clearTaskRuns().then(() => setRuns([]));
  }, []);

  return (
    <CollapsibleSection
      title="Background Notifications"
      icon="bell-badge-outline"
      isDark={isDark}
      defaultOpen={false}
      testID="debug-section-background-notifications"
    >
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderText, { color: mutedColor }]}>Native push worker</Text>
      </View>
      {!pushRunsRead.ok ? (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          {`Could not read native push runs: ${engineErrorTag(pushRunsRead.error) ?? String(pushRunsRead.error)}`}
        </Text>
      ) : pushRuns.length > 0 ? (
        pushRuns.map((run) => (
          <View key={`${run.ts}-${run.activityId}-${run.outcome}`} style={styles.taskRunRow}>
            <View style={styles.taskRunHeader}>
              <Text style={[styles.statValue, { color: textColor }]}>{run.outcome}</Text>
              <Text style={[styles.statLabel, { color: mutedColor }]}>
                {new Date(run.ts * 1000).toLocaleTimeString()}
              </Text>
            </View>
            <Text style={[styles.taskRunDetail, { color: mutedColor }]} numberOfLines={2}>
              {[run.activityId, run.detail].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))
      ) : (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          No native push runs recorded yet.
        </Text>
      )}

      <View style={[styles.tableHeader, styles.taskRunGroup]}>
        <Text style={[styles.tableHeaderText, { color: mutedColor }]}>JavaScript task</Text>
      </View>
      {runs.length > 0 ? (
        <>
          {runs.map((run, idx) => (
            <View key={`${run.ts}-${idx}`} style={styles.taskRunRow}>
              <View style={styles.taskRunHeader}>
                <Text style={[styles.statValue, { color: textColor }]}>{run.stage}</Text>
                <Text style={[styles.statLabel, { color: mutedColor }]}>
                  {new Date(run.ts).toLocaleTimeString()}
                </Text>
              </View>
              <Text style={[styles.taskRunDetail, { color: mutedColor }]} numberOfLines={2}>
                {[run.eventType, run.activityId, run.sourceShape, run.detail]
                  .filter(Boolean)
                  .join(' · ') || '-'}
              </Text>
            </View>
          ))}
          <TouchableOpacity style={styles.actionButton} onPress={handleClear} activeOpacity={0.7}>
            <MaterialCommunityIcons name="delete-outline" size={16} color={colors.primary} />
            <Text
              style={[
                styles.actionButtonText,
                { color: isDark ? darkColors.linkTeal : colors.linkTeal },
              ]}
            >
              Clear Log
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          No background task runs recorded yet.
        </Text>
      )}
    </CollapsibleSection>
  );
}

function DebugScreenContent() {
  const { isDark } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 200);
  }, []);

  // Engine stats, re-read on pull to refresh and on nothing else.
  const statsRead = useMemo(
    () => attemptEngineRead((): PersistentEngineStats | undefined => getEngine()?.getStats()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refresh reads engine stats on demand.
    [refreshKey]
  );
  const stats = statsRead.value;

  // The Rust to JavaScript event seam, re-read with the engine stats.
  const events = useMemo(
    () => getEngine()?.engineEventDiagnostics() ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refresh reads event diagnostics on demand.
    [refreshKey]
  );
  const eventChannels = events
    ? [
        ...new Set([
          ...Object.keys(events.received),
          ...Object.keys(events.delivered),
          ...Object.keys(events.listeners),
        ]),
      ].sort()
    : [];

  // FFI metrics
  const ffiSummary = getFFIMetricsSummary();
  const queueReport = readSnapshotQueueReport();
  const ffiMethods = Object.entries(ffiSummary).sort(([, a], [, b]) => b.totalMs - a.totalMs);

  const timelineRuns = freshLoginTimeline.runs();

  // Tile store counters
  const tileCounts = readBasemapTileCounts();

  // Memory
  const mem = getMemoryStats();

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  const handleClearMetrics = useCallback(() => {
    clearFFIMetrics();
    freshLoginTimeline.clear();
    resetBasemapTileCounts();
    setRefreshKey((k) => k + 1);
  }, []);

  // Not memoised: ffiSummary and mem are read fresh every render, so any
  // dependency list here is new on every render anyway.
  const handleShareSnapshot = async () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      app: {
        version: Constants.expoConfig?.version ?? 'unknown',
        platform: Platform.OS,
        buildType: __DEV__ ? 'development' : 'production',
      },
      engineStats: stats ?? null,
      engineEvents: events,
      ffiMetrics: ffiSummary,
      syncTimeline: timelineRuns,
      tileCounts,
      memory: mem,
    };
    await Share.share({ message: JSON.stringify(snapshot, null, 2) });
  };

  return (
    <View
      testID="debug-screen"
      style={{ flex: 1, backgroundColor: isDark ? darkColors.background : colors.background }}
    >
      <ScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Engine Stats */}
        <CollapsibleSection title="Engine Stats" icon="database" isDark={isDark}>
          {stats ? (
            <>
              <StatRow label="Activities" value={String(stats.activityCount)} isDark={isDark} />
              <StatRow label="GPS Tracks" value={String(stats.gpsTrackCount)} isDark={isDark} />
              <StatRow label="Groups" value={String(stats.groupCount)} isDark={isDark} />
              <StatRow label="Sections" value={String(stats.sectionCount)} isDark={isDark} />
              <StatRow
                label="Signature Cache"
                value={`${stats.signatureCacheSize}/200`}
                isDark={isDark}
              />
              <StatRow
                label="Groups Dirty"
                value={stats.groupsDirty ? 'Yes' : 'No'}
                isDark={isDark}
              />
              <StatRow
                label="Sections Dirty"
                value={stats.sectionsDirty ? 'Yes' : 'No'}
                isDark={isDark}
              />
              <StatRow
                label="Date Range"
                value={`${formatDate(stats.oldestDate ?? null)} - ${formatDate(stats.newestDate ?? null)}`}
                isDark={isDark}
              />
            </>
          ) : !statsRead.ok ? (
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              {`Could not read engine stats: ${engineErrorTag(statsRead.error) ?? String(statsRead.error)}`}
            </Text>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>Engine not initialized</Text>
          )}
        </CollapsibleSection>

        {/* Engine events: what Rust announced, what JavaScript heard */}
        <CollapsibleSection
          title="Engine Events"
          icon="bell-ring-outline"
          isDark={isDark}
          testID="debug-section-engine-events"
        >
          {events ? (
            <>
              <StatRow label="Events live" value={events.live ? 'Yes' : 'No'} isDark={isDark} />
              <StatRow
                label="Binding init"
                value={events.bindingInitError ?? 'OK'}
                isDark={isDark}
              />
              <StatRow label="Observer" value={events.observerError ?? 'OK'} isDark={isDark} />
              {eventChannels.length === 0 ? (
                <Text style={[styles.emptyText, { color: mutedColor }]}>
                  No announcement has reached JavaScript this process.
                </Text>
              ) : (
                eventChannels.map((channel) => (
                  <StatRow
                    key={channel}
                    label={channel}
                    value={`${events.received[channel] ?? 0} in, ${events.delivered[channel] ?? 0} out, ${events.listeners[channel] ?? 0} listening`}
                    isDark={isDark}
                  />
                ))
              )}
            </>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>Engine not initialized</Text>
          )}
        </CollapsibleSection>

        {/* FFI Performance */}
        <CollapsibleSection title="FFI Performance" icon="speedometer" isDark={isDark}>
          {ffiMethods.length > 0 ? (
            <>
              {/* Header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, styles.methodCol, { color: mutedColor }]}>
                  Method
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  Calls
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  Avg
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  Max
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  p95
                </Text>
              </View>
              {ffiMethods.map(([name, m]) => (
                <View
                  key={name}
                  style={[styles.tableRow, { borderLeftColor: getAvgColor(m.avgMs) }]}
                >
                  <Text
                    style={[styles.tableCell, styles.methodCol, { color: textColor }]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: textColor }]}>
                    {m.calls}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: getAvgColor(m.avgMs) }]}>
                    {m.avgMs.toFixed(0)}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: textColor }]}>
                    {m.maxMs.toFixed(0)}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: textColor }]}>
                    {m.p95Ms.toFixed(0)}
                  </Text>
                </View>
              ))}
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleClearMetrics}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="delete-outline" size={16} color={colors.primary} />
                <Text
                  style={[
                    styles.actionButtonText,
                    { color: isDark ? darkColors.linkTeal : colors.linkTeal },
                  ]}
                >
                  Clear Metrics
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              No FFI metrics recorded yet. Use the app with debug mode enabled.
            </Text>
          )}
        </CollapsibleSection>

        {/* Preview queue trace: the last events the render pool recorded */}
        <CollapsibleSection
          title="Preview queue"
          icon="map-clock-outline"
          isDark={isDark}
          testID="debug-section-preview-queue"
        >
          {queueReport ? (
            <Text
              selectable
              style={[styles.tableCell, { color: textColor }]}
              testID="debug-preview-queue-report"
            >
              {queueReport}
            </Text>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              No preview pool has run this process.
            </Text>
          )}
        </CollapsibleSection>

        {/* Sync timeline */}
        <CollapsibleSection title="Sync timeline" icon="timeline-clock-outline" isDark={isDark}>
          {timelineRuns.length > 0 ? (
            timelineRuns.map((run, i) => (
              <View key={`${run.startedAtMs}-${i}`} testID={`sync-timeline-run-${i}`}>
                <Text style={[styles.tableCell, { color: textColor }]}>
                  {`${run.outcome} ${run.totalMs ?? '-'} ms, build ${run.build ?? 'unstamped'}, ${run.clock} time`}
                </Text>
                <Text style={[styles.tableCell, { color: mutedColor }]}>
                  {Object.entries(run.milestones)
                    .map(([name, ms]) => `${name} ${ms === null ? 'unobserved' : `${ms} ms`}`)
                    .join(', ')}
                </Text>
                {run.steps.map((s) => (
                  <Text
                    key={`${s.step}-${s.startMs}`}
                    style={[styles.tableCell, { color: mutedColor }]}
                  >
                    {`${s.step} +${s.startMs} ms, ${s.durationMs === null ? 'open' : `${s.durationMs} ms`}`}
                  </Text>
                ))}
              </View>
            ))
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>No sync observed yet.</Text>
          )}
        </CollapsibleSection>

        {/* Tile store */}
        <CollapsibleSection title="Map tiles" icon="map-outline" isDark={isDark}>
          {tileCounts.length > 0 ? (
            <>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, styles.methodCol, { color: mutedColor }]}>
                  Source
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  Hits
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  Misses
                </Text>
                <Text style={[styles.tableHeaderText, styles.numCol, { color: mutedColor }]}>
                  Fetches
                </Text>
              </View>
              {tileCounts.map((row) => (
                <View key={row.source} style={styles.tableRow}>
                  <Text
                    style={[styles.tableCell, styles.methodCol, { color: textColor }]}
                    numberOfLines={1}
                  >
                    {row.source}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: textColor }]}>
                    {row.hits}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: textColor }]}>
                    {row.misses}
                  </Text>
                  <Text style={[styles.tableCell, styles.numCol, { color: textColor }]}>
                    {row.fetches}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              No tiles requested since start or the last reset.
            </Text>
          )}
        </CollapsibleSection>

        {/* Memory */}
        <CollapsibleSection title="Memory" icon="memory" isDark={isDark}>
          {mem ? (
            <>
              <StatRow label="JS Heap" value={`${mem.heapMB} MB`} isDark={isDark} />
              <StatRow label="Allocated" value={`${mem.allocMB} MB`} isDark={isDark} />
              <StatRow label="GC Count" value={String(mem.gcCount)} isDark={isDark} />
            </>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              Hermes internals not available
            </Text>
          )}
        </CollapsibleSection>

        {/* Background Notifications */}
        <BackgroundNotificationsDebug isDark={isDark} refreshKey={refreshKey} />

        {/* Support Card Testing */}
        <SupportCardDebug isDark={isDark} />

        {/* Share Debug Snapshot */}
        <TouchableOpacity
          style={[styles.shareButton, isDark && styles.shareButtonDark]}
          onPress={handleShareSnapshot}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="share-variant" size={18} color={colors.primary} />
          <Text
            style={[
              styles.shareButtonText,
              { color: isDark ? darkColors.linkTeal : colors.linkTeal },
            ]}
          >
            Share Debug Snapshot
          </Text>
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  );
}

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
    paddingBottom: spacing.md + TAB_BAR_SAFE_PADDING,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
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
    fontSize: typography.body.fontSize,
    fontWeight: '600',
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
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: typography.bodyCompact.fontSize,
    fontFamily: 'monospace',
    color: colors.textPrimary,
    fontWeight: '500',
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  emptyText: {
    fontSize: typography.bodyCompact.fontSize,
    fontStyle: 'italic',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    marginBottom: spacing.xs,
  },
  tableHeaderText: {
    fontSize: typography.label.fontSize,
    fontFamily: 'monospace',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderLeftWidth: 3,
    paddingLeft: spacing.xsPlus,
    marginLeft: -spacing.xxs,
  },
  tableCell: {
    fontSize: typography.caption.fontSize,
    fontFamily: 'monospace',
  },
  methodCol: {
    flex: 1,
  },
  numCol: {
    width: 48,
    textAlign: 'right',
  },
  taskRunGroup: {
    marginTop: spacing.md,
  },
  taskRunRow: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  taskRunHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  taskRunDetail: {
    fontSize: typography.label.fontSize,
    fontFamily: 'monospace',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
    marginTop: spacing.sm,
    paddingVertical: spacing.xsPlus,
  },
  actionButtonText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '500',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  shareButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  shareButtonText: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
  },
});

export default withScreenBoundary(DebugScreenContent, 'Debug');
