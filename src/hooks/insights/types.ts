/**
 * Shared types for insight generators.
 *
 * Each category file used to re-declare these locally, which invited silent
 * divergence if the orchestrator added a field but a category file didn't.
 * Keep them here so one source of truth reaches every generator.
 */

import type { Insight, InsightCategory, InsightPriority } from '@/types';

export interface PeriodStats {
  count: number;
  totalDuration: number; // seconds
  totalDistance: number; // meters
  totalTss: number;
}

export interface FtpTrend {
  latestFtp: number | undefined;
  latestDate: bigint | number | undefined;
  previousFtp: number | undefined;
  previousDate: bigint | number | undefined;
}

export interface PaceTrend {
  latestPace: number | undefined;
  latestDate: bigint | number | undefined;
  previousPace: number | undefined;
  previousDate: bigint | number | undefined;
}

export interface SectionPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
}

export interface SectionTrendData {
  sectionId: string;
  sectionName: string;
  /** -1=declining, 0=stable, 1=improving */
  trend: number;
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  sportType?: string;
  daysSinceLast?: number;
  latestIsPr?: boolean;
}

/** Translation function signature (react-i18next-compatible). */
export type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** Re-export insight types for convenience so generators have one import. */
export type { Insight, InsightCategory, InsightPriority };
