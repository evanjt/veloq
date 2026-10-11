import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, Platform, Share } from 'react-native';
import Constants from 'expo-constants';
import { Button, ScreenScrollView, useTabBarClearance, pressable, pressRipple } from '@/shared/ui';
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
import type { FfiDashboardData, FfiRequestBudget, PersistentEngineStats } from 'veloqrs';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import {
  attemptEngineRead,
  engineErrorTag,
  type EngineReadResult,
} from '@/shared/native/engineError';

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        testID={testID}
        style={pressable(styles.sectionHeader)}
        onPress={() => setOpen(!open)}
        android_ripple={pressRipple}
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
      </Pressable>
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
      <Text style={[styles.statLabel, isDark && styles.textSecondary]}>{label}</Text>
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
          <Button
            key={p.days}
            testID={`debug-support-preset-${p.days}d`}
            label={p.label}
            onPress={() =>
              debugOverride({
                lastActionDate: daysAgoLocal(p.days),
                permanentlyDismissed: false,
                dismissCount: 0,
              })
            }
            variant="ghost"
            size="sm"
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Button
          label="Clear dismissed"
          onPress={() =>
            debugOverride({
              lastActionDate: daysAgoLocal(31),
              permanentlyDismissed: false,
            })
          }
          variant="ghost"
          size="sm"
        />
        <Button
          testID="debug-support-legacy-toggle"
          label={`${isLegacyPurchaser ? 'Unset' : 'Set'} legacy`}
          onPress={() => debugOverride({ isLegacyPurchaser: !isLegacyPurchaser })}
          variant="ghost"
          size="sm"
        />
      </View>
    </CollapsibleSection>
  );
}

/** The dashboard's own engine read, taken once per refresh by the screen. */
type DashboardRead = EngineReadResult<FfiDashboardData | undefined>;

function BackgroundNotificationsDebug({
  isDark,
  refreshKey,
  dashboard,
}: {
  isDark: boolean;
  refreshKey: number;
  dashboard: DashboardRead;
}) {
  const [runs, setRuns] = useState<TaskRunEntry[]>([]);
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;

  // The native worker's own runs. It has no JavaScript in its process, so it
  // writes them to the engine and nothing of it reaches the ring above.
  const pushRuns = (dashboard.ok ? dashboard.value?.pushRuns : undefined) ?? [];

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
      {!dashboard.ok ? (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          {`Could not read native push runs: ${engineErrorTag(dashboard.error) ?? String(dashboard.error)}`}
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
          <Button
            label="Clear Log"
            onPress={handleClear}
            variant="ghost"
            size="sm"
            style={styles.actionButton}
            icon={<MaterialCommunityIcons name="delete-outline" size={16} color={colors.primary} />}
          />
        </>
      ) : (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          No background task runs recorded yet.
        </Text>
      )}
    </CollapsibleSection>
  );
}

function RequestBudgetDebug({ isDark, dashboard }: { isDark: boolean; dashboard: DashboardRead }) {
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const budget: FfiRequestBudget | undefined = dashboard.ok
    ? dashboard.value?.requestBudget
    : undefined;
  const instant = (seconds: number) => new Date(seconds * 1000).toLocaleString();
  const share = (used: number, allowance: number | undefined) =>
    allowance == null ? String(used) : `${used} / ${allowance}`;

  return (
    <CollapsibleSection
      title="Request budget"
      icon="gauge"
      isDark={isDark}
      defaultOpen={false}
      testID="debug-section-request-budget"
    >
      {!dashboard.ok ? (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          {`Could not read the request budget: ${engineErrorTag(dashboard.error) ?? String(dashboard.error)}`}
        </Text>
      ) : budget ? (
        <>
          <StatRow
            label="Cooldown until"
            value={budget.cooldownUntil == null ? 'none' : instant(budget.cooldownUntil)}
            isDark={isDark}
          />
          <StatRow label="Daily reset" value={instant(budget.nextReset)} isDark={isDark} />
          <StatRow
            label="Backfill, 15 min"
            value={share(budget.backfillLastFifteenMinutes, budget.backfillPerFifteenMinutes)}
            isDark={isDark}
          />
          <StatRow
            label="Backfill, today"
            value={share(budget.backfillToday, budget.backfillPerDay)}
            isDark={isDark}
          />
          <StatRow
            label="Sync, 15 min"
            value={share(budget.syncLastFifteenMinutes, budget.syncPerFifteenMinutes)}
            isDark={isDark}
          />
          <StatRow label="Sync, today" value={String(budget.syncToday)} isDark={isDark} />
          <StatRow label="User, today" value={String(budget.userToday)} isDark={isDark} />
          <Text style={[styles.emptyText, { color: mutedColor }]}>
            Sign-in calls through the OAuth proxy spend the same shared limits and are not counted
            here.
          </Text>
        </>
      ) : (
        <Text style={[styles.emptyText, { color: mutedColor }]}>
          No request budget is kept in this build.
        </Text>
      )}
    </CollapsibleSection>
  );
}

function DebugScreenContent() {
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();
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

  // The worker's push runs and the request budget, read with the engine stats.
  const dashboard = useMemo(
    () => attemptEngineRead((): FfiDashboardData | undefined => getEngine()?.dashboardData()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refresh reads the dashboard on demand.
    [refreshKey]
  );

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
      <ScreenScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.md + tabBarClearance }]}
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
                label="SQLite Heap"
                value={`${(stats.sqliteHeapBytes / 1024 / 1024).toFixed(1)} MB`}
                isDark={isDark}
              />
              <StatRow
                label="Satellite Cache"
                value={`${(stats.satelliteCacheBytes / 1024 / 1024).toFixed(1)}/32 MB`}
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
            <Text style={[styles.emptyText, { color: mutedColor }]}>Engine not initialised</Text>
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
            <Text style={[styles.emptyText, { color: mutedColor }]}>Engine not initialised</Text>
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
                    {m.p95Ms.toFixed(1)}
                  </Text>
                </View>
              ))}
              <Button
                label="Clear Metrics"
                onPress={handleClearMetrics}
                variant="ghost"
                size="sm"
                style={styles.actionButton}
                icon={
                  <MaterialCommunityIcons name="delete-outline" size={16} color={colors.primary} />
                }
              />
            </>
          ) : (
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              No FFI metrics recorded yet. Use the app with debug mode enabled.
            </Text>
          )}
        </CollapsibleSection>

        <RequestBudgetDebug isDark={isDark} dashboard={dashboard} />

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
                <Text style={[styles.tableCell, { color: mutedColor }]}>
                  {run.openedTrack === null
                    ? 'opened track unobserved'
                    : `opened track +${run.openedTrack.openedAtMs} ms, waited ${run.openedTrack.waitMs === null ? 'unobserved' : `${run.openedTrack.waitMs} ms`}`}
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
        <BackgroundNotificationsDebug
          isDark={isDark}
          refreshKey={refreshKey}
          dashboard={dashboard}
        />

        {/* Support Card Testing */}
        <SupportCardDebug isDark={isDark} />

        {/* Share Debug Snapshot */}
        <Button
          label="Share Debug Snapshot"
          onPress={handleShareSnapshot}
          variant="secondary"
          icon={<MaterialCommunityIcons name="share-variant" size={18} color={colors.primary} />}
        />

        <View style={{ height: spacing.xl }} />
      </ScreenScrollView>
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
    fontFamily: typography.code.fontFamily,
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: typography.bodyCompact.fontSize,
    fontFamily: typography.code.fontFamily,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  textSecondary: {
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
    fontFamily: typography.code.fontFamily,
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
    fontFamily: typography.code.fontFamily,
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
    fontFamily: typography.code.fontFamily,
  },
  actionButton: {
    marginTop: spacing.sm,
  },
});

export default withScreenBoundary(DebugScreenContent, 'Debug');
