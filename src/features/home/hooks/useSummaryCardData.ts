import { useMemo, useCallback, useState } from 'react';
import { summaryCardFtp } from '@/features/home/lib/summaryCardFtp';
import { useTranslation } from 'react-i18next';
import { useAthlete } from '@/shared/app/useAthlete';
import { useStableBy } from '@/shared/app/useStableBy';
import { useWellnessGeneration } from '@/features/wellness';
import { useSportSettings, getSettingsForSport } from '@/shared/app/useSportSettings';
import { usePaceCurve } from '@/features/stats';
import { getFormZone, formZoneTextColor, formZoneLabel } from '@/features/fitness/lib/fitness';
import { useSportPreference, SPORT_COLORS } from '@/features/fitness/stores';
import { useDashboardPreferences } from '@/features/home/store';
import { type MetricId } from '@/features/home/store';
import { formatPaceCompact, formatSwimPace } from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { colors } from '@/theme';
import type { WellnessSparklines } from 'veloqrs';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import {
  trendGlyph,
  trendOfMetric,
  type TrendGlyph,
  type TrendMetric,
} from '@/shared/format/trend';

/**
 * Supporting metric for SummaryCard display
 */
interface SupportingMetric {
  label: string;
  value: string | number;
  color?: string | undefined;
  trend?: TrendGlyph | undefined;
  navigationTarget?: '/fitness' | '/training' | undefined;
}

/**
 * Return type for useSummaryCardData hook
 */
export interface SummaryCardData {
  // Profile
  profileUrl?: string | undefined;

  // Hero metric
  heroMetric: string;
  heroValue: number | string;
  heroLabel: string;
  heroColor: string;
  heroZoneLabel?: string | undefined;
  heroZoneColor?: string | undefined;
  heroTrend?: TrendGlyph | undefined;

  // Sparkline (fitness/form dual chart or HRV/RHR chart)
  fitnessData?: number[] | undefined;
  fatigueData?: number[] | undefined;
  formData?: number[] | undefined;
  hrvData?: number[] | undefined;
  rhrData?: number[] | undefined;
  showSparkline: boolean;

  // Supporting metrics
  supportingMetrics: SupportingMetric[];

  // State
  isLoading: boolean;

  // Actions
  refetch: () => Promise<void>;
}

/** Returns the previous reference while the value serialises the same. */
function useStableValue<T>(value: T): T {
  return useStableBy(value, JSON.stringify(value));
}

/** Returns the previous reference while every element is identical. */
function useStableArray(arr: number[] | undefined): number[] | undefined {
  // `undefined` and the empty array are different answers, so the key says
  // which: a series nobody has loaded against one the athlete has no data for.
  return useStableBy(arr, arr === undefined ? 'none' : arr.join(','));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrecomputedCardData = any;

/**
 * The window the card draws, and the one the engine bundles. Kept beside the
 * fallback read so a caller without a bundle asks for the same month.
 */
const FEED_SPARKLINE_DAYS = 30;

/** What a metric with no reading behind it draws, everywhere on the card. */
const PLACEHOLDER = '-';

/**
 * Hook that provides all data needed for SummaryCard.
 *
 * When `precomputedCardData` is provided (from getStartupData), skips the
 * redundant getSummaryCardData FFI call and uses the pre-fetched data instead.
 *
 * `awaitPrecomputed` is for the feed, whose bundle arrives after the first
 * paint: it renders defaults until then rather than putting its own read back
 * on the render path. A caller with no bundle at all leaves it off and keeps
 * the direct read.
 *
 * `precomputedSparklines` comes from the same bundle. `undefined` means the
 * caller has no bundle and the sparklines are read here; `null` means the
 * bundle said the athlete has no wellness, which is an answer and not a miss.
 */
export function useSummaryCardData(
  precomputedCardData?: PrecomputedCardData,
  {
    awaitPrecomputed = false,
    precomputedSparklines,
  }: {
    awaitPrecomputed?: boolean | undefined;
    precomputedSparklines?: WellnessSparklines | null | undefined;
  } = {}
): SummaryCardData {
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const { primarySport } = useSportPreference();
  const { data: sportSettings } = useSportSettings();
  const summaryCard = useDashboardPreferences((s) => s.summaryCard);
  const isMetric = useMetricSystem();

  // Check if pace/CSS metrics are enabled (determines which pace curves to fetch)
  const hasPaceMetric = summaryCard.supportingMetrics.includes('thresholdPace');
  const hasCssMetric = summaryCard.supportingMetrics.includes('css');

  // Fetch pace curves - also triggers snapshot of critical speed for trend tracking
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    enabled: primarySport === 'Running' || hasPaceMetric,
  });
  const { data: swimPaceCurve } = usePaceCurve({
    sport: 'Swim',
    enabled: hasCssMetric,
  });

  // Profile URL
  const profileUrl = athlete?.profile_medium || athlete?.profile;

  // The card's wellness numbers come out of the engine bundle below. What is
  // left to subscribe to is the fact of a sync, so the sparklines look again;
  // a month of parsed bodies was being kept mounted for that alone.
  const wellnessGeneration = useWellnessGeneration();
  // A pull-to-refresh makes the card look at the engine again. The feed's own
  // refresh already invalidates the wellness keys, so this is the card's half
  // rather than a second invalidation of the same thing.
  const [refreshTick, setRefreshTick] = useState(0);

  // Subscribe to engine activity events - re-query when activity_metrics are populated
  const readCardData = useEngineRead(['activities']);

  // Under `awaitPrecomputed` the bundle has not answered yet, so every number
  // below is a default rather than a reading. The card draws `PLACEHOLDER` for
  // all of them: `0 Fitness` and `Week 0h` read as measurements.
  const isLoading = awaitPrecomputed && !precomputedCardData;

  const refetch = useCallback(async () => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  // Engine-derived stats - uses precomputed data from getStartupData when available,
  // falls back to direct FFI call (settings preview, non-feed contexts)
  const engineStats = useMemo(() => {
    const defaults = {
      fitness: undefined as number | undefined,
      fitnessTrend: undefined as TrendGlyph | undefined,
      form: undefined as number | undefined,
      formTrend: undefined as TrendGlyph | undefined,
      hrv: null as number | null,
      hrvTrend: undefined as TrendGlyph | undefined,
      rhr: null as number | null,
      rhrTrend: undefined as TrendGlyph | undefined,
      weight: null as number | null,
      weightTrend: undefined as TrendGlyph | undefined,
      weekHours: 0,
      weekHoursTrend: undefined as TrendGlyph | undefined,
      weekCount: 0,
      weekCountTrend: undefined as TrendGlyph | undefined,
      ftp: null as number | null,
      ftpTrend: undefined as TrendGlyph | undefined,
      thresholdPaceTrend: undefined as TrendGlyph | undefined,
      cssTrend: undefined as TrendGlyph | undefined,
    };

    const getTrend = (
      current: number | null,
      prev: number | null,
      metric: TrendMetric
    ): TrendGlyph => trendGlyph(metric, trendOfMetric(metric, current, prev));

    // Use precomputed data from getStartupData if available
    let cardData = precomputedCardData;

    if (!cardData) {
      if (awaitPrecomputed) return defaults;

      const getMonday = (date: Date): Date => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
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

      cardData = readCardData((engine) =>
        engine.getSummaryCardData(
          Math.floor(currentMonday.getTime() / 1000),
          Math.floor(currentSunday.getTime() / 1000),
          Math.floor(prevMonday.getTime() / 1000),
          Math.floor(prevSunday.getTime() / 1000)
        )
      );
    }

    if (!cardData?.currentWeek) return defaults;

    const weekCount = cardData.currentWeek.count;
    const weekSeconds = Number(cardData.currentWeek.totalDuration);
    const prevWeekSeconds = Number(cardData.prevWeek.totalDuration);

    const weekHours = Math.round((weekSeconds / 3600) * 10) / 10;
    const prevWeekHours = Math.round((prevWeekSeconds / 3600) * 10) / 10;

    const cyclingSettings = getSettingsForSport(sportSettings, 'Ride');
    const { value: latestFtp, previous: prevFtp } = summaryCardFtp({
      trend: cardData.ftpTrend,
      configuredFtp: cyclingSettings?.ftp ?? null,
    });

    const runPaceTrend = cardData.runPaceTrend;
    const swimPaceTrend = cardData.swimPaceTrend;

    // The engine judged these, so the card draws the glyph it was handed
    // rather than re-deciding what the move meant. A bundle from before the
    // field existed carries none, and reads as no library rather than throwing.
    const w = cardData.wellness ?? defaults;

    return {
      fitness: w.fitness,
      fitnessTrend: w.fitnessTrend as TrendGlyph | undefined,
      form: w.form,
      formTrend: w.formTrend as TrendGlyph | undefined,
      hrv: w.hrv ?? null,
      hrvTrend: w.hrvTrend as TrendGlyph | undefined,
      rhr: w.rhr ?? null,
      rhrTrend: w.rhrTrend as TrendGlyph | undefined,
      weight: w.weight ?? null,
      weightTrend: w.weightTrend as TrendGlyph | undefined,
      weekHours,
      weekHoursTrend: getTrend(weekHours, prevWeekHours, 'weekHours'),
      weekCount,
      weekCountTrend: getTrend(weekCount, cardData.prevWeek.count, 'weekCount'),
      ftp: latestFtp,
      ftpTrend: getTrend(latestFtp, prevFtp, 'ftp'),
      thresholdPaceTrend: getTrend(
        runPaceTrend.latestPace ?? null,
        runPaceTrend.previousPace ?? null,
        'thresholdPace'
      ),
      cssTrend: getTrend(
        swimPaceTrend.latestPace ?? null,
        swimPaceTrend.previousPace ?? null,
        'css'
      ),
    };
  }, [precomputedCardData, awaitPrecomputed, readCardData, sportSettings]);

  // Merged quick stats - recomputes only when either source changes
  const quickStats = engineStats;

  const asPercent = useFormPreference((state) => state.formAsPercent) === true;
  const formZone =
    quickStats.form == null
      ? undefined
      : getFormZone(quickStats.form, quickStats.fitness, asPercent);
  // The hero value and the zone label are text, so they take the text variant
  // rather than the band fill they used to.
  const isDark = useResolvedColorScheme() === 'dark';
  const formColor = formZone ? formZoneTextColor(formZone, isDark) : colors.success;

  // Build hero metric data based on summaryCard preferences
  const heroData = useMemo(() => {
    const metric = summaryCard.heroMetric;

    switch (metric) {
      case 'form':
        return {
          value: quickStats.form ?? PLACEHOLDER,
          label: t('metrics.form'),
          color: formColor,
          zoneLabel: formZone ? formZoneLabel(formZone) : undefined,
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
      case 'fitness':
      default:
        return {
          value: quickStats.fitness ?? PLACEHOLDER,
          label: t('metrics.fitness'),
          color: colors.fitnessBlue,
          zoneLabel: undefined,
          zoneColor: undefined,
          trend: quickStats.fitnessTrend,
        };
    }
  }, [summaryCard.heroMetric, quickStats, formColor, formZone, t]);

  // Sparklines pulled from Rust (wellness persisted in SQLite via
  // `upsertWellness` in useWellness). Rust does the 30-day slice, CTL/ATL
  // coalescing, form as rounded ctl minus rounded atl, and HRV/RHR forward-fill in one round-trip.
  // The reader is keyed on the wellness generation and the refresh tick, so
  // the memo refreshes after each wellness sync and each pull-to-refresh.
  const readSparklines = useEngineRead([], [wellnessGeneration, refreshTick]);
  const sparklines = useMemo(() => {
    if (!summaryCard.showSparkline) return null;
    if (precomputedSparklines !== undefined) return precomputedSparklines;
    return (
      readSparklines((engine) => {
        if (!engine.getWellnessSparklines) return null;
        try {
          return engine.getWellnessSparklines(FEED_SPARKLINE_DAYS);
        } catch {
          return null;
        }
      }) ?? null
    );
  }, [summaryCard.showSparkline, precomputedSparklines, readSparklines]);

  const fitnessData = sparklines?.fitness;
  const fatigueData = sparklines?.fatigue;
  const formData = sparklines?.form;
  const hrvData = sparklines?.hrv && sparklines.hrv.length > 0 ? sparklines.hrv : undefined;
  const rhrData = sparklines?.rhr && sparklines.rhr.length > 0 ? sparklines.rhr : undefined;

  // Get sport-specific metrics
  const sportMetrics = useMemo(() => {
    const runSettings = getSettingsForSport(sportSettings, 'Run');
    const swimSettings = getSettingsForSport(sportSettings, 'Swim');

    const thresholdPace = runPaceCurve?.criticalSpeed ?? null;

    return {
      thresholdPace,
      runLthr: runSettings?.lthr ?? null,
      css: swimSettings?.threshold_pace ?? swimPaceCurve?.criticalSpeed ?? null,
    };
  }, [sportSettings, runPaceCurve, swimPaceCurve]);

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
            value: quickStats.fitness ?? PLACEHOLDER,
            color: colors.fitnessBlue,
            trend: quickStats.fitnessTrend,
            navigationTarget: '/fitness' as const,
          };
        case 'form':
          return {
            label: t('metrics.form'),
            value:
              quickStats.form == null
                ? PLACEHOLDER
                : quickStats.form > 0
                  ? `+${quickStats.form}`
                  : quickStats.form,
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
            trend: quickStats.thresholdPaceTrend,
            navigationTarget: '/fitness' as const,
          };
        case 'css':
          return {
            label: t('metrics.css'),
            value: sportMetrics.css ? formatSwimPace(sportMetrics.css) : '-',
            color: SPORT_COLORS.Swimming,
            trend: quickStats.cssTrend,
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
            trend: quickStats.weekCountTrend,
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
  const stableHeroData = useStableValue(
    isLoading
      ? {
          ...heroData,
          value: PLACEHOLDER,
          zoneLabel: undefined,
          zoneColor: undefined,
          trend: undefined,
        }
      : heroData
  );
  const stableFitnessData = useStableArray(fitnessData);
  const stableFatigueData = useStableArray(fatigueData);
  const stableFormData = useStableArray(formData);
  const stableHrvData = useStableArray(hrvData);
  const stableRhrData = useStableArray(rhrData);
  const stableSupportingMetrics = useStableValue(
    isLoading
      ? supportingMetrics.map((metric) => ({ ...metric, value: PLACEHOLDER, trend: undefined }))
      : supportingMetrics
  );

  return useMemo(
    () => ({
      profileUrl,
      heroMetric: summaryCard.heroMetric,
      heroValue: stableHeroData.value,
      heroLabel: stableHeroData.label,
      heroColor: stableHeroData.color,
      heroZoneLabel: stableHeroData.zoneLabel,
      heroZoneColor: stableHeroData.zoneColor,
      heroTrend: stableHeroData.trend,
      fitnessData: stableFitnessData,
      fatigueData: stableFatigueData,
      formData: stableFormData,
      hrvData: stableHrvData,
      rhrData: stableRhrData,
      showSparkline: summaryCard.showSparkline,
      supportingMetrics: stableSupportingMetrics,
      isLoading,
      refetch,
    }),
    [
      profileUrl,
      summaryCard.heroMetric,
      stableHeroData,
      stableFitnessData,
      stableFatigueData,
      stableFormData,
      stableHrvData,
      stableRhrData,
      summaryCard.showSparkline,
      stableSupportingMetrics,
      isLoading,
      refetch,
    ]
  );
}
