import React, { useState, useCallback } from 'react';
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
import { Stack } from 'expo-router';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, spacing } from '@/theme';
import { useTheme } from '@/hooks';
import { getFFIMetricsSummary, clearFFIMetrics } from '@/lib/debug/renderTimer';
import { useSupportStore, daysSince } from '@/providers';
import { formatLocalDate } from '@/lib/utils/format';
import type { PersistentEngineStats } from 'veloqrs';

function getRouteEngine() {
  try {
    const mod = require('veloqrs');
    return mod.RouteEngineClient?.getInstance() ?? null;
  } catch {
    return null;
  }
}

function getMemoryStats(): { heapMB: string; allocMB: string; gcCount: number } | null {
  const stats = (global as any).HermesInternal?.getInstrumentedStats?.();
  if (!stats) return null;
  return {
    heapMB: (stats['js_heapSize'] / 1024 / 1024).toFixed(1),
    allocMB: (stats['js_totalAllocatedBytes'] / 1024 / 1024).toFixed(1),
    gcCount: stats['js_numGCs'] ?? 0,
  };
}

function formatDate(ts: number | bigint | null | undefined): string {
  if (ts == null) return '-';
  return new Date(Number(ts) * 1000).toLocaleDateString();
}

interface CollapsibleSectionProps {
  title: string;
  icon: string;
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
  if (avgMs > 100) return '#ef4444';
  if (avgMs > 50) return '#f59e0b';
  return '#22c55e';
}

function daysAgoLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}

function MapStressTest({ isDark }: { isDark: boolean }) {
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  const presets = [
    { label: '100', count: 100, testID: 'debug-stress-100' },
    { label: '500', count: 500, testID: 'debug-stress-500' },
    { label: '1000', count: 1000, testID: 'debug-stress-1000' },
    { label: '2000', count: 2000, testID: 'debug-stress-2000' },
  ];

  const handleLoad = useCallback(
    (count: number) => {
      if (loading) return;
      setLoading(true);
      setDone(false);
      setLines([]);
      const t0 = Date.now();
      const log = (line: string) => {
        const ms = Date.now() - t0;
        const mem = getMemoryStats();
        const memSuffix = mem ? ` heap=${mem.heapMB}MB alloc=${mem.allocMB}MB` : '';
        setLines((prev) => [...prev, `[+${String(ms).padStart(5, ' ')}ms] ${line}${memSuffix}`]);
      };
      const run = async () => {
        try {
          log(`target=${count} activities`);
          const { generateStressMapChunks } = require('@/data/demo/stressMapData');
          const client = getRouteEngine();
          if (!client?.engine) {
            log(`FAIL: engine unavailable (client=${!!client})`);
            return;
          }

          const before = client.engine.activities().getCount();
          log(`engine: before=${before} activities`);

          const tGen = Date.now();
          const allIds: string[] = [];
          const allCoords: number[] = [];
          const allOffsets: number[] = [];
          const allSports: string[] = [];
          const allMetrics: any[] = [];
          let longestKm = 0;
          let generated = 0;
          for (const chunk of generateStressMapChunks(count, 100)) {
            const baseOffset = allCoords.length / 2;
            for (const id of chunk.ids) allIds.push(id);
            for (const off of chunk.offsets) allOffsets.push(baseOffset + off);
            for (const c of chunk.coords) allCoords.push(c);
            for (const st of chunk.sportTypes) allSports.push(st);
            for (const m of chunk.metrics) allMetrics.push(m);
            if (chunk.longestKm > longestKm) longestKm = chunk.longestKm;
            generated += chunk.ids.length;
            log(
              `gen +${chunk.ids.length} (total ${generated}/${count}, pts=${(allCoords.length / 2).toLocaleString()})`
            );
            await new Promise((r) => setTimeout(r, 0));
          }
          const genMs = Date.now() - tGen;
          log(
            `gen done: ${genMs}ms (${allIds.length} act, ${(allCoords.length / 2).toLocaleString()} pts, longest=${longestKm.toFixed(0)}km)`
          );
          await new Promise((r) => setTimeout(r, 0));

          const tAdd = Date.now();
          client.engine.activities().add(allIds, allCoords, allOffsets, allSports);
          log(`ffi add(): ${Date.now() - tAdd}ms`);
          await new Promise((r) => setTimeout(r, 0));

          const tMetrics = Date.now();
          client.engine.activities().setMetrics(allMetrics);
          log(`ffi setMetrics(): ${Date.now() - tMetrics}ms`);
          await new Promise((r) => setTimeout(r, 0));

          const tNotify = Date.now();
          client.notifyAll('activities', 'groups');
          log(`notifyAll: ${Date.now() - tNotify}ms`);

          const after = client.engine.activities().getCount();
          log(`engine: after=${after} (Δ ${after - before})`);
          log(`OK total=${Date.now() - t0}ms`);
          setDone(true);
        } catch (e) {
          log(`ERROR: ${e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`);
        } finally {
          setLoading(false);
        }
      };
      void run();
    },
    [loading]
  );

  return (
    <CollapsibleSection
      title="Map Stress Testing"
      icon="map-marker-multiple"
      isDark={isDark}
      defaultOpen={true}
      testID="debug-section-map-stress"
    >
      <Text style={[{ fontSize: 11, marginBottom: spacing.sm }, { color: mutedColor }]}>
        Buffer GPS+metrics in JS, then one FFI add() + one setMetrics(). R-tree rebuild runs once.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {presets.map((p) => (
          <TouchableOpacity
            key={p.count}
            testID={p.testID}
            onPress={() => handleLoad(p.count)}
            disabled={loading}
            style={[
              styles.actionButton,
              { paddingHorizontal: spacing.sm, opacity: loading ? 0.4 : 1 },
            ]}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionButtonText, { color: colors.primary }]}>+{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {lines.length > 0 ? (
        <View
          testID={done ? 'debug-stress-result' : 'debug-stress-loading'}
          style={{
            marginTop: spacing.sm,
            padding: spacing.xs,
            backgroundColor: isDark ? '#0a0a0a' : '#f4f4f4',
            borderRadius: 4,
            maxHeight: 320,
          }}
        >
          <ScrollView>
            {lines.map((line, i) => (
              <Text
                key={i}
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: line.startsWith('[') ? (isDark ? '#ddd' : '#222') : colors.error,
                }}
              >
                {line}
              </Text>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </CollapsibleSection>
  );
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
        style={[{ fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }, { color: mutedColor }]}
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
            <Text style={[styles.actionButtonText, { color: colors.primary }]}>{p.label}</Text>
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
          <Text style={[styles.actionButtonText, { color: colors.primary }]}>Clear dismissed</Text>
        </TouchableOpacity>
        <TouchableOpacity
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

export default function DebugScreen() {
  const { isDark } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 200);
  }, []);

  // Engine stats
  const engine = getRouteEngine();
  const stats: PersistentEngineStats | undefined = engine?.getStats();

  // FFI metrics
  const ffiSummary = getFFIMetricsSummary();
  const ffiMethods = Object.entries(ffiSummary).sort(([, a], [, b]) => b.totalMs - a.totalMs);

  // Memory
  const mem = getMemoryStats();

  // Force re-read on refreshKey
  void refreshKey;

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  const handleClearMetrics = useCallback(() => {
    clearFFIMetrics();
    setRefreshKey((k) => k + 1);
  }, []);

  const handleShareSnapshot = useCallback(async () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      app: {
        version: Constants.expoConfig?.version ?? 'unknown',
        platform: Platform.OS,
        buildType: __DEV__ ? 'development' : 'production',
      },
      engineStats: stats ?? null,
      ffiMetrics: ffiSummary,
      memory: mem,
    };
    await Share.share({ message: JSON.stringify(snapshot, null, 2) });
  }, [stats, ffiSummary, mem]);

  return (
    <View
      testID="debug-screen"
      style={{ flex: 1, backgroundColor: isDark ? darkColors.background : colors.background }}
    >
      <Stack.Screen
        options={{
          title: 'Developer Dashboard',
          headerShown: true,
          headerStyle: { backgroundColor: isDark ? darkColors.surface : colors.surface },
          headerTintColor: isDark ? darkColors.textPrimary : colors.textPrimary,
          headerLeft: () => (
            <TouchableOpacity
              testID="debug-back"
              onPress={() => require('expo-router').router.back()}
              style={{ padding: spacing.sm }}
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color={isDark ? darkColors.textPrimary : colors.textPrimary}
              />
            </TouchableOpacity>
          ),
        }}
      />
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
                label="Consensus Cache"
                value={`${stats.consensusCacheSize}/50`}
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
                <Text style={[styles.actionButtonText, { color: colors.primary }]}>
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

        {/* Map Stress Testing */}
        <MapStressTest isDark={isDark} />

        {/* Support Card Testing */}
        <SupportCardDebug isDark={isDark} />

        {/* Share Debug Snapshot */}
        <TouchableOpacity
          style={[styles.shareButton, isDark && styles.shareButtonDark]}
          onPress={handleShareSnapshot}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="share-variant" size={18} color={colors.primary} />
          <Text style={[styles.shareButtonText, { color: colors.primary }]}>
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
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    marginBottom: 4,
  },
  tableHeaderText: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderLeftWidth: 3,
    paddingLeft: 6,
    marginLeft: -2,
  },
  tableCell: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  methodCol: {
    flex: 1,
  },
  numCol: {
    width: 48,
    textAlign: 'right',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 6,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  shareButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
