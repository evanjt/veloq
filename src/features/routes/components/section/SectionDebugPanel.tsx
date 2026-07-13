import React from 'react';
import { DebugInfoPanel } from '../DebugInfoPanel';
import { DebugWarningBanner } from '../DebugWarningBanner';
import { formatRelativeDate } from '@/shared/format/format';
import type { FrequentSection } from '@/types';

interface FFITimerEntry {
  name: string;
  durationMs: number;
  timestamp: number;
}

export interface SectionDebugPanelProps {
  section: FrequentSection;
  pageMetrics: FFITimerEntry[];
  isDark: boolean;
}

export function SectionDebugPanel({ section, pageMetrics, isDark }: SectionDebugPanelProps) {
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
  const actCount = section.activityIds.length;
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
  if (section.polyline.length > 2000)
    warnings.push({
      level: 'warn',
      message: `${section.polyline.length} polyline points (>2000)`,
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
            value: section.id.length > 20 ? section.id.slice(0, 20) + '...' : section.id,
          },
          { label: 'Type', value: section.sectionType },
          {
            label: 'Stability',
            value: Number.isFinite(section.stability) ? section.stability!.toFixed(3) : '-',
          },
          {
            label: 'Version',
            value: section.version != null ? String(section.version) : '-',
          },
          {
            label: 'Updated',
            value: section.updatedAt ? formatRelativeDate(section.updatedAt) : '-',
          },
          {
            label: 'Created',
            value: section.createdAt ? formatRelativeDate(section.createdAt) : '-',
          },
          {
            label: 'Confidence',
            value: Number.isFinite(section.confidence) ? section.confidence!.toFixed(2) : '-',
          },
          {
            label: 'Observations',
            value: section.observationCount != null ? String(section.observationCount) : '-',
          },
          {
            label: 'Avg Spread',
            value: Number.isFinite(section.averageSpread)
              ? section.averageSpread!.toFixed(1) + 'm'
              : '-',
          },
          {
            label: 'Reference',
            value: section.representativeActivityId
              ? section.representativeActivityId.slice(0, 20) + '...'
              : '-',
          },
          {
            label: 'User Defined',
            value: section.isUserDefined ? 'Yes' : 'No',
          },
          { label: 'Activities', value: String(actCount) },
          {
            label: 'Points',
            value: String(section.polyline.length),
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
