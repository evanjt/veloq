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
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  icon,
  isDark,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
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
    <View style={{ flex: 1, backgroundColor: isDark ? darkColors.background : colors.background }}>
      <Stack.Screen
        options={{
          title: 'Developer Dashboard',
          headerShown: true,
          headerStyle: { backgroundColor: isDark ? darkColors.surface : colors.surface },
          headerTintColor: isDark ? darkColors.textPrimary : colors.textPrimary,
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
