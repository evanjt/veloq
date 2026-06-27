import type { RouteGroup as EngineRouteGroup } from 'veloqrs';

import { formatDistance, formatDuration } from '@/shared/format/format';
import { DebugInfoPanel } from './DebugInfoPanel';
import { DebugWarningBanner } from './DebugWarningBanner';
import type { RouteStats } from '../lib/computeRouteStats';
import type { RoutePerformancePoint } from '../hooks/useRoutePerformances';

interface FfiMetric {
  name: string;
  durationMs: number;
}

interface RouteDetailDebugPanelProps {
  engineGroup: EngineRouteGroup;
  routeStats: RouteStats;
  bestPerformance: RoutePerformancePoint | null;
  pageMetrics: FfiMetric[];
  isDark: boolean;
  isMetric: boolean;
}

export function RouteDetailDebugPanel({
  engineGroup,
  routeStats,
  bestPerformance,
  pageMetrics,
  isDark,
  isMetric,
}: RouteDetailDebugPanelProps) {
  const ffiEntries = pageMetrics.reduce<
    Record<string, { calls: number; totalMs: number; maxMs: number }>
  >((acc, m) => {
    if (!acc[m.name]) acc[m.name] = { calls: 0, totalMs: 0, maxMs: 0 };
    acc[m.name].calls++;
    acc[m.name].totalMs += m.durationMs;
    acc[m.name].maxMs = Math.max(acc[m.name].maxMs, m.durationMs);
    return acc;
  }, {});
  const warnings: Array<{
    level: 'warn' | 'error';
    message: string;
  }> = [];
  const actCount = engineGroup.activityIds.length;
  if (actCount > 500)
    warnings.push({
      level: 'error',
      message: `${actCount} activities (>500)`,
    });
  else if (actCount > 100)
    warnings.push({
      level: 'warn',
      message: `${actCount} activities (>100)`,
    });
  for (const [name, m] of Object.entries(ffiEntries)) {
    if (m.maxMs > 200)
      warnings.push({
        level: 'error',
        message: `${name}: ${m.maxMs.toFixed(0)}ms (max)`,
      });
  }
  return (
    <>
      {warnings.length > 0 && <DebugWarningBanner warnings={warnings} />}
      <DebugInfoPanel
        isDark={isDark}
        entries={[
          {
            label: 'ID',
            value:
              engineGroup.groupId.length > 20
                ? engineGroup.groupId.slice(0, 20) + '...'
                : engineGroup.groupId,
          },
          { label: 'Type', value: engineGroup.sportType || '-' },
          { label: 'Activities', value: String(actCount) },
          {
            label: 'Avg Distance',
            value: routeStats.distance > 0 ? formatDistance(routeStats.distance, isMetric) : '-',
          },
          {
            label: 'Best Time',
            value:
              bestPerformance?.duration != null ? formatDuration(bestPerformance.duration) : '-',
          },
          ...Object.entries(ffiEntries).map(([name, m]) => ({
            label: name,
            value: `${m.calls}x ${m.totalMs.toFixed(0)}ms`,
          })),
        ]}
      />
    </>
  );
}
