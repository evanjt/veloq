import { useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAthlete } from '@/hooks/useAthlete';
import { useWellness } from '@/hooks/fitness';
import { useSportSettings, getSettingsForSport } from '@/hooks/useSportSettings';
import { usePaceCurve } from '@/hooks/charts';
import { getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS } from '@/lib';
import { useDashboardPreferences, useSportPreference, SPORT_COLORS } from '@/providers';
import type { MetricId } from '@/providers';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import { useMetricSystem } from '@/hooks/ui/useMetricSystem';
import { colors } from '@/theme';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';

/**
 * Supporting metric for SummaryCard display
 */
interface SupportingMetric {
  label: string;
  value: string | number;
  color?: string;
  trend?: '↑' | '↓' | '';
  navigationTarget?: '/fitness' | '/training';
}

/**
 * Return type for useSummaryCardData hook
 */
export interface SummaryCardData {
  // Profile
  profileUrl?: string;

  // Hero metric
  heroValue: number | string;
  heroLabel: string;
  heroColor: string;
  heroZoneLabel?: string;
  heroZoneColor?: string;
  heroTrend?: '↑' | '↓' | '';

  // Sparkline (fitness/form dual chart)
  fitnessData?: number[];
  formData?: number[];
  showSparkline: boolean;

  // Supporting metrics
  supportingMetrics: SupportingMetric[];

  // State
  isLoading: boolean;

  // Actions
  refetch: () => Promise<void>;
}

/** Returns previous reference if structurally equal (JSON comparison). */
function useStableValue<T>(value: T): T {
  const ref = useRef(value);
  const serialized = JSON.stringify(value);
  const prevSerialized = useRef(serialized);
  if (serialized !== prevSerialized.current) {
    ref.current = value;
    prevSerialized.current = serialized;
  }
  return ref.current;
}

/** Returns previous reference if all elements are identical. */
function useStableArray(arr: number[] | undefined): number[] | undefined {
  const ref = useRef(arr);
  if (arr === undefined && ref.current === undefined) return ref.current;
  if (arr === undefined || ref.current === undefined || arr.length !== ref.current.length) {
    ref.current = arr;
    return ref.current;
  }
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== ref.current[i]) {
      ref.current = arr;
      return ref.current;
    }
  }
  return ref.current;
}

/**
 * Hook that provides all data needed for SummaryCard.
 *
 * Extracts the data calculation logic from the home screen so it can be
 * reused in settings preview and other places that need the same data.
 *
 * Uses: useAthlete, useWellness, useSportSettings, usePaceCurve,
 * useDashboardPreferences, useSportPreference
 */
export function useSummaryCardData(): SummaryCardData {
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const { primarySport } = useSportPreference();
  const { data: sportSettings } = useSportSettings();
  const { summaryCard } = useDashboardPreferences();
  const isMetric = useMetricSystem();

  // Fetch pace curve for running threshold pace
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    enabled: primarySport === 'Running',
  });

  // Profile URL
  const profileUrl = athlete?.profile_medium || athlete?.profile;

  // Fetch wellness data for form, fitness, HRV
  const {
    data: wellnessData,
    isLoading: wellnessLoading,
    refetch: refetchWellness,
  } = useWellness('1m');

  // Subscribe to engine activity events — re-query when activity_metrics are populated
  const engineTrigger = useEngineSubscription(['activities']);

  const isLoading = wellnessLoading;

  const refetch = useCallback(async () => {
    await refetchWellness();
  }, [refetchWellness]);

  // Wellness-derived stats (pure JS math, no FFI calls)
  const wellnessStats = useMemo(() => {
    const sorted = wellnessData ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id)) : [];
    const latest = sorted[0];
    const previous = sorted[1];

    const fitness = Math.round(latest?.ctl ?? latest?.ctlLoad ?? 0);
    const fatigue = Math.round(latest?.atl ?? latest?.atlLoad ?? 0);
    const form = fitness - fatigue;
    const hrv = latest?.hrv ?? null;
    const rhr = latest?.restingHR ?? null;
    const weight = latest?.weight ?? null;

    const prevFitness = Math.round(previous?.ctl ?? previous?.ctlLoad ?? fitness);
    const prevFatigue = Math.round(previous?.atl ?? previous?.atlLoad ?? fatigue);
    const prevForm = prevFitness - prevFatigue;
    const prevHrv = previous?.hrv ?? hrv;
    const prevRhr = previous?.restingHR ?? rhr;
    const prevWeight = previous?.weight ?? weight;

    const getTrend = (
      current: number | null,
      prev: number | null,
      threshold = 1
    ): '↑' | '↓' | '' => {
      if (current === null || prev === null) return '';
      const diff = current - prev;
      if (Math.abs(diff) < threshold) return '';
      return diff > 0 ? '↑' : '↓';
    };

    return {
      fitness,
      fitnessTrend: getTrend(fitness, prevFitness, 1),
      form,
      formTrend: getTrend(form, prevForm, 2),
      hrv,
      hrvTrend: getTrend(hrv, prevHrv, 2),
      rhr,
      rhrTrend: getTrend(rhr, prevRhr, 1),
      weight,
      weightTrend: getTrend(weight, prevWeight, 0.5),
    };
  }, [wellnessData]);

  // Engine-derived stats (FFI calls: getPeriodStats x2 + getFtpTrend)
  const engineStats = useMemo(() => {
    const defaults = {
      weekHours: 0,
      weekHoursTrend: '' as const,
      weekCount: 0,
      weekCountTrend: '' as const,
      ftp: null as number | null,
      ftpTrend: '' as const,
    };

    const engine = getRouteEngine();
    if (!engine) return defaults;

    const getMonday = (date: Date): Date => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const getTrend = (
      current: number | null,
      prev: number | null,
      threshold = 1
    ): '↑' | '↓' | '' => {
      if (current === null || prev === null) return '';
      const diff = current - prev;
      if (Math.abs(diff) < threshold) return '';
      return diff > 0 ? '↑' : '↓';
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentMonday = getMonday(today);
    const currentSunday = new Date(currentMonday);
    currentSunday.setDate(currentMonday.getDate() + 6);
    currentSunday.setHours(23, 59, 59, 999);

    const prevMonday = new Date(currentMonday);
    prevMonday.setDate(currentMonday.getDate() - 7);
    const prevSunday = new Date(currentMonday);
    prevSunday.setDate(currentMonday.getDate() - 1);
    prevSunday.setHours(23, 59, 59, 999);

    const currentWeekStats = engine.getPeriodStats(
      Math.floor(currentMonday.getTime() / 1000),
      Math.floor(currentSunday.getTime() / 1000)
    );
    const prevWeekStats = engine.getPeriodStats(
      Math.floor(prevMonday.getTime() / 1000),
      Math.floor(prevSunday.getTime() / 1000)
    );

    const weekCount = currentWeekStats.count;
    const weekSeconds = Number(currentWeekStats.totalDuration);
    const prevWeekSeconds = Number(prevWeekStats.totalDuration);

    const weekHours = Math.round((weekSeconds / 3600) * 10) / 10;
    const prevWeekHours = Math.round((prevWeekSeconds / 3600) * 10) / 10;

    const ftpResult = engine.getFtpTrend();
    const latestFtp = ftpResult.latestFtp ?? null;
    const prevFtp = ftpResult.previousFtp ?? null;

    return {
      weekHours,
      weekHoursTrend: getTrend(weekHours, prevWeekHours, 0.5),
      weekCount,
      weekCountTrend: getTrend(weekCount, prevWeekStats.count, 1),
      ftp: latestFtp,
      ftpTrend: getTrend(latestFtp, prevFtp ?? latestFtp, 3),
    };
  }, [engineTrigger]);

  // Merged quick stats — recomputes only when either source changes
  const quickStats = useMemo(
    () => ({ ...wellnessStats, ...engineStats }),
    [wellnessStats, engineStats]
  );

  const formZone = getFormZone(quickStats.form);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : colors.success;

  // Build hero metric data based on summaryCard preferences
  const heroData = useMemo(() => {
    const metric = summaryCard.heroMetric;

    switch (metric) {
      case 'form':
      case 'fitness':
        return {
          value: quickStats.form,
          label: t('metrics.form'),
          color: formColor,
          zoneLabel: formZone ? FORM_ZONE_LABELS[formZone] : undefined,
          zoneColor: formColor,
          trend: quickStats.formTrend,
        };
      case 'hrv':
        return {
          value: quickStats.hrv ?? '-',
          label: t('metrics.hrv'),
          color: colors.chartPink,
          zoneLabel: undefined,
          zoneColor: undefined,
          trend: quickStats.hrvTrend,
        };
      default:
        return {
          value: quickStats.form,
          label: t('metrics.form'),
          color: formColor,
          zoneLabel: formZone ? FORM_ZONE_LABELS[formZone] : undefined,
          zoneColor: formColor,
          trend: quickStats.formTrend,
        };
    }
  }, [summaryCard.heroMetric, quickStats, formColor, formZone, t]);

  // Build fitness and form data arrays from wellness (last 30 days)
  const fitnessData = useMemo(() => {
    if (!summaryCard.showSparkline) return undefined;
    if (!wellnessData || wellnessData.length === 0) return undefined;
    const sorted = [...wellnessData].sort((a, b) => a.id.localeCompare(b.id)).slice(-30);
    return sorted.map((w) => Math.round(w.ctl ?? w.ctlLoad ?? 0));
  }, [wellnessData, summaryCard.showSparkline]);

  const formData = useMemo(() => {
    if (!summaryCard.showSparkline) return undefined;
    if (!wellnessData || wellnessData.length === 0) return undefined;
    const sorted = [...wellnessData].sort((a, b) => a.id.localeCompare(b.id)).slice(-30);
    return sorted.map((w) => {
      const ctl = w.ctl ?? w.ctlLoad ?? 0;
      const atl = w.atl ?? w.atlLoad ?? 0;
      return Math.round(ctl - atl);
    });
  }, [wellnessData, summaryCard.showSparkline]);

  // Get sport-specific metrics
  const sportMetrics = useMemo(() => {
    const runSettings = getSettingsForSport(sportSettings, 'Run');
    const swimSettings = getSettingsForSport(sportSettings, 'Swim');

    const thresholdPace = runPaceCurve?.criticalSpeed ?? null;

    return {
      thresholdPace,
      runLthr: runSettings?.lthr ?? null,
      css: swimSettings?.threshold_pace ?? null,
    };
  }, [sportSettings, runPaceCurve]);

  // Format weight value with unit
  const formattedWeight = useMemo(() => {
    if (quickStats.weight === null) return '-';
    if (isMetric) return `${Math.round(quickStats.weight * 10) / 10}kg`;
    return `${Math.round(quickStats.weight * 2.20462 * 10) / 10}lb`;
  }, [quickStats.weight, isMetric]);

  // Build supporting metrics array from preferences
  const supportingMetrics = useMemo(() => {
    // Filter out weight when no data is available
    const metricIds = summaryCard.supportingMetrics
      .filter((id: MetricId) => id !== 'weight' || quickStats.weight !== null)
      .slice(0, 4);
    return metricIds.map((metricId: MetricId) => {
      switch (metricId) {
        case 'fitness':
          return {
            label: t('metrics.fitness'),
            value: quickStats.fitness,
            color: colors.fitnessBlue,
            trend: quickStats.fitnessTrend,
            navigationTarget: '/fitness' as const,
          };
        case 'form':
          return {
            label: t('metrics.form'),
            value: quickStats.form > 0 ? `+${quickStats.form}` : quickStats.form,
            color: formColor,
            trend: quickStats.formTrend,
            navigationTarget: '/fitness' as const,
          };
        case 'hrv':
          return {
            label: t('metrics.hrv'),
            value: quickStats.hrv ?? '-',
            color: colors.chartPink,
            trend: quickStats.hrvTrend,
            navigationTarget: '/training' as const,
          };
        case 'rhr':
          return {
            label: t('metrics.rhr'),
            value: quickStats.rhr ?? '-',
            color: undefined,
            trend: quickStats.rhrTrend,
            navigationTarget: '/training' as const,
          };
        case 'ftp':
          return {
            label: t('metrics.ftp'),
            value: quickStats.ftp ?? '-',
            color: SPORT_COLORS.Cycling,
            trend: quickStats.ftpTrend,
            navigationTarget: '/fitness' as const,
          };
        case 'thresholdPace':
          return {
            label: t('metrics.pace'),
            value: sportMetrics.thresholdPace ? formatPaceCompact(sportMetrics.thresholdPace) : '-',
            color: SPORT_COLORS.Running,
            trend: undefined,
            navigationTarget: '/fitness' as const,
          };
        case 'css':
          return {
            label: t('metrics.css'),
            value: sportMetrics.css ? formatSwimPace(sportMetrics.css) : '-',
            color: SPORT_COLORS.Swimming,
            trend: undefined,
            navigationTarget: '/fitness' as const,
          };
        case 'weekHours':
          return {
            label: t('metrics.week'),
            value: `${quickStats.weekHours}h`,
            color: undefined,
            trend: quickStats.weekHoursTrend,
          };
        case 'weekCount':
          return {
            label: '#',
            value: quickStats.weekCount,
            color: undefined,
            trend: undefined,
          };
        case 'weight':
          return {
            label: '\u2696\uFE0F',
            value: formattedWeight,
            color: undefined,
            trend: quickStats.weightTrend,
            navigationTarget: '/training' as const,
          };
        default:
          return {
            label: metricId,
            value: '-',
            color: undefined,
            trend: undefined,
          };
      }
    });
  }, [summaryCard.supportingMetrics, quickStats, formColor, formattedWeight, sportMetrics, t]);

  // Stabilize references to prevent downstream re-renders when values are unchanged
  const stableHeroData = useStableValue(heroData);
  const stableFitnessData = useStableArray(fitnessData);
  const stableFormData = useStableArray(formData);
  const stableSupportingMetrics = useStableValue(supportingMetrics);

  return useMemo(
    () => ({
      profileUrl,
      heroValue: stableHeroData.value,
      heroLabel: stableHeroData.label,
      heroColor: stableHeroData.color,
      heroZoneLabel: stableHeroData.zoneLabel,
      heroZoneColor: stableHeroData.zoneColor,
      heroTrend: stableHeroData.trend,
      fitnessData: stableFitnessData,
      formData: stableFormData,
      showSparkline: summaryCard.showSparkline,
      supportingMetrics: stableSupportingMetrics,
      isLoading,
      refetch,
    }),
    [
      profileUrl,
      stableHeroData,
      stableFitnessData,
      stableFormData,
      summaryCard.showSparkline,
      stableSupportingMetrics,
      isLoading,
      refetch,
    ]
  );
}
