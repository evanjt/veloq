import { useMemo, useCallback, useState } from 'react';
import { summaryCardFtp } from '@/features/home/lib/summaryCardFtp';
import { useTranslation } from 'react-i18next';
import { useAthlete } from '@/shared/app/useAthlete';
import { useStableBy } from '@/shared/app/useStableBy';
import { useWellnessGeneration } from '@/features/wellness';
import { formatForm, getFormZone } from '@/features/fitness';
import { summaryFormZoneColor, summarySeriesColor } from '@/features/home/lib/summaryMetricColour';
import { useDashboardPreferences, type MetricId } from '@/features/settings';
import { summaryCardTarget } from '@/features/home/lib/summaryCardTargets';
import {
  formatPaceCompact,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
  formatDurationHuman,
} from '@/shared/format/format';
import { spokenDuration, spokenPace, spokenSwimPace } from '@/shared/format/spoken';
import { formatWeightCompact } from '@/shared/format/weight';
import { ABSENT } from '@/shared/format/absent';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import type { WellnessSparklines } from 'veloqrs';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import type { TrendGlyph } from '@/shared/format/trend';
import {
  summaryMetricLabel,
  type SummaryTrendBaseline,
} from '@/features/home/lib/summaryCardTrendLabel';

/**
 * Supporting metric for SummaryCard display
 */
interface SupportingMetric {
  label: string;
  /** The metric's name for a screen reader, where the label is a glyph. */
  name: string;
  value: string | number;
  /** The unit the value is read in, drawn after it; a placeholder has none. */
  unit?: string | undefined;
  color?: string | undefined;
  trend?: TrendGlyph | undefined;
  /** What a screen reader hears: the value, and what its arrow was judged against. */
  accessibilityLabel: string;
  /** The route and chart a tap opens, from the one table the hero reads too. */
  navigationTarget: string;
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
  /** The colour of the key dot beside the hero value, absent while it has no series to key. */
  heroKeyColor?: string | undefined;
  heroZone?: string | undefined;
  heroTrend?: TrendGlyph | undefined;
  heroAccessibilityLabel: string;

  // Sparkline (fitness/form dual chart or HRV/RHR chart)
  fitnessData?: number[] | undefined;
  fitnessDelta?: number | null | undefined;
  fitnessRiseDays?: number[] | undefined;
  fatigueData?: number[] | undefined;
  formData?: number[] | undefined;
  hrvData?: number[] | undefined;
  rhrData?: number[] | undefined;
  /** Beside `hrvData` and `rhrData`: whether each day had a reading of its own. */
  hrvRead?: boolean[] | undefined;
  rhrRead?: boolean[] | undefined;
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
function useStableArray<T extends number | boolean>(arr: T[] | undefined): T[] | undefined {
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

/** A critical speed the card can print, or null for none. */
function measuredSpeed(speed: number | null | undefined): number | null {
  return speed != null && speed > 0 ? speed : null;
}

/** An earlier reading and the day it was read, as the engine dated it. */
interface DayReading {
  value: number;
  date: number;
}

/** The reading an arrow was judged against, or none when the engine found none. */
function dayReading(
  value: number | null | undefined,
  date: number | bigint | null | undefined
): DayReading | undefined {
  return value == null || date == null ? undefined : { value, date: Number(date) };
}

/** What each of the card's arrows was judged against, before formatting. */
interface Baselines {
  fitness?: DayReading | undefined;
  form?: DayReading | undefined;
  /** The fitness beside the earlier form, which a percentage form is read against. */
  fitnessForForm?: number | undefined;
  hrv?: DayReading | undefined;
  rhr?: DayReading | undefined;
  weight?: DayReading | undefined;
  ftp?: DayReading | undefined;
  thresholdPace?: DayReading | undefined;
  css?: DayReading | undefined;
  weekHours?: number | undefined;
  weekCount?: number | undefined;
}

/** A dated baseline in the form the label names it, formatted as the value is. */
function onDay(
  reading: DayReading | undefined,
  format: (value: number) => string | number | null = (value) => value
): SummaryTrendBaseline | undefined {
  if (!reading) return undefined;
  const previous = format(reading.value);
  return previous == null ? undefined : { kind: 'day', previous, date: reading.date };
}

/** What a metric with no reading behind it draws, everywhere on the card. */
const PLACEHOLDER = ABSENT;

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
  const summaryCard = useDashboardPreferences((s) => s.summaryCard);
  const isMetric = useMetricSystem();

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
      weekSeconds: 0,
      weekHoursTrend: undefined as TrendGlyph | undefined,
      weekCount: 0,
      weekCountTrend: undefined as TrendGlyph | undefined,
      ftp: null as number | null,
      ftpTrend: undefined as TrendGlyph | undefined,
      thresholdPace: null as number | null,
      thresholdPaceTrend: undefined as TrendGlyph | undefined,
      css: null as number | null,
      cssTrend: undefined as TrendGlyph | undefined,
      baselines: {} as Baselines,
    };

    // Use precomputed data from getStartupData if available
    let cardData = precomputedCardData;

    if (!cardData) {
      if (awaitPrecomputed) return defaults;

      // The engine resolves matching week windows from this wall-clock stamp.
      const nowWallSeconds = localWallClockToEpochSeconds(new Date());
      cardData = readCardData((engine) => engine.getSummaryCardData(nowWallSeconds));
    }

    if (!cardData?.currentWeek) return defaults;

    const weekCount = cardData.currentWeek.count;
    const weekSeconds = Number(cardData.currentWeek.totalDuration);
    const prevWeekSeconds = Number(cardData.prevWeek.totalDuration);

    const weekHours = Math.round((weekSeconds / 3600) * 10) / 10;
    const prevWeekHours = Math.round((prevWeekSeconds / 3600) * 10) / 10;

    const { value: latestFtp, previous: prevFtp } = summaryCardFtp({
      trend: cardData.ftpTrend,
    });
    const ftpTrend = cardData.ftpTrend;

    const runPaceTrend = cardData.runPaceTrend;
    const swimPaceTrend = cardData.swimPaceTrend;

    // The engine judged these, so the card draws the glyph it was handed
    // rather than re-deciding what the move meant. A bundle from before the
    // field existed carries none, and reads as no library rather than throwing.
    const w = cardData.wellness ?? defaults;

    return {
      // What each arrow was judged against, as the engine read it, so the
      // label can name it. Formatting waits for the athlete's units below.
      baselines: {
        fitness: dayReading(w.fitnessPrevious, w.fitnessPreviousDate),
        form: dayReading(w.formPrevious, w.formPreviousDate),
        fitnessForForm: w.fitnessPrevious,
        hrv: dayReading(w.hrvPrevious, w.hrvPreviousDate),
        rhr: dayReading(w.rhrPrevious, w.rhrPreviousDate),
        weight: dayReading(w.weightPrevious, w.weightPreviousDate),
        ftp: dayReading(prevFtp, ftpTrend?.previousDate),
        thresholdPace: dayReading(
          measuredSpeed(runPaceTrend?.previousPace),
          runPaceTrend?.previousDate
        ),
        css: dayReading(measuredSpeed(swimPaceTrend?.previousPace), swimPaceTrend?.previousDate),
        weekHours: prevWeekHours,
        weekCount: cardData.prevWeek.count as number,
      },
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
      // The engine judged the week and FTP arrows too, on the same table.
      weekHours,
      weekSeconds,
      weekHoursTrend: cardData.weekHoursTrend as TrendGlyph | undefined,
      weekCount,
      weekCountTrend: cardData.weekCountTrend as TrendGlyph | undefined,
      ftp: latestFtp,
      ftpTrend: ftpTrend?.glyph as TrendGlyph | undefined,
      // Measured critical speed, the series the arrow and the widget read.
      // The arrow is the engine's, judged on pace in the sport's own unit:
      // judged here on m/s, a faster athlete drew a decline.
      thresholdPace: measuredSpeed(runPaceTrend?.latestPace),
      thresholdPaceTrend: runPaceTrend?.glyph as TrendGlyph | undefined,
      css: measuredSpeed(swimPaceTrend?.latestPace),
      cssTrend: swimPaceTrend?.glyph as TrendGlyph | undefined,
    };
  }, [precomputedCardData, awaitPrecomputed, readCardData]);

  // Merged quick stats - recomputes only when either source changes
  const quickStats = engineStats;

  const asPercent = useFormPreference((state) => state.formAsPercent) === true;
  const formZone =
    quickStats.form == null
      ? undefined
      : getFormZone(quickStats.form, quickStats.fitness, asPercent);
  // The form hero's key dot takes its zone's mark, and none before a form reading.
  const isDark = useResolvedColorScheme() === 'dark';
  const formKeyColor = formZone ? summaryFormZoneColor(formZone, isDark) : undefined;

  // A metric's spoken name, its value where the card draws it as a clock, and
  // the reading its arrow was judged against, formatted in the athlete's units
  // as the value is. An abbreviated name is said in full, and a pace or a
  // duration that the card draws as a clock is said in words.
  const spokenOf = useCallback(
    (
      id: MetricId
    ): {
      name: string;
      value?: string | undefined;
      baseline: SummaryTrendBaseline | undefined;
    } => {
      const b = quickStats.baselines;
      const lastWeek = (previous: string | number | undefined): SummaryTrendBaseline | undefined =>
        previous === undefined ? undefined : { kind: 'lastWeek', previous };
      const hours = (h: number): string => spokenDuration(Math.round(h * 3600));
      switch (id) {
        case 'fitness':
          return { name: t('metrics.fitness'), baseline: onDay(b.fitness) };
        case 'form':
          return {
            name: t('metrics.form'),
            baseline: onDay(b.form, (v) => formatForm(v, b.fitnessForForm, asPercent)),
          };
        case 'hrv':
          return { name: t('spoken.hrv'), baseline: onDay(b.hrv) };
        case 'rhr':
          return { name: t('spoken.rhr'), baseline: onDay(b.rhr) };
        case 'weight':
          return {
            name: t('metrics.weight'),
            baseline: onDay(b.weight, (v) => formatWeightCompact(v, isMetric)),
          };
        case 'ftp':
          return { name: t('metrics.eftp'), baseline: onDay(b.ftp) };
        case 'thresholdPace':
          return {
            name: t('metrics.pace'),
            value:
              quickStats.thresholdPace == null
                ? undefined
                : spokenPace(quickStats.thresholdPace, isMetric),
            baseline: onDay(b.thresholdPace, (v) => spokenPace(v, isMetric)),
          };
        case 'css':
          return {
            name: t('metrics.css'),
            value: quickStats.css == null ? undefined : spokenSwimPace(quickStats.css, isMetric),
            baseline: onDay(b.css, (v) => spokenSwimPace(v, isMetric)),
          };
        case 'weekHours':
          return {
            name: t('metrics.week'),
            value: spokenDuration(Math.round(quickStats.weekSeconds)),
            baseline: lastWeek(b.weekHours === undefined ? undefined : hours(b.weekHours)),
          };
        case 'weekCount':
          return { name: t('metrics.activityCount'), baseline: lastWeek(b.weekCount) };
        default: {
          const unhandled: never = id;
          return { name: String(unhandled), baseline: undefined };
        }
      }
    },
    [
      quickStats.baselines,
      quickStats.thresholdPace,
      quickStats.css,
      quickStats.weekSeconds,
      asPercent,
      isMetric,
      t,
    ]
  );

  // What a screen reader hears for a metric: its value, and beside an arrow
  // what the arrow means and that baseline. A dash is not a reading, so a
  // metric showing one is spoken by name alone.
  const describe = useCallback(
    (id: MetricId, value: string | number, trend: TrendGlyph | undefined): string => {
      const said = spokenOf(id);
      if (value === PLACEHOLDER) return said.name;
      return summaryMetricLabel(t, {
        name: said.name,
        value: said.value ?? value,
        metric: id,
        trend,
        baseline: said.baseline,
      });
    },
    [spokenOf, t]
  );

  // Build hero metric data based on summaryCard preferences
  const heroData = useMemo(() => {
    const hero =
      summaryCard.heroMetric === 'hrv'
        ? {
            value: quickStats.hrv ?? PLACEHOLDER,
            label: t('metrics.hrv'),
            keyColor: summarySeriesColor('hrv', isDark),
            trend: quickStats.hrvTrend,
          }
        : summaryCard.heroMetric === 'form'
          ? {
              value:
                (quickStats.form == null
                  ? null
                  : formatForm(quickStats.form, quickStats.fitness, asPercent)) ?? PLACEHOLDER,
              label: t('metrics.form'),
              keyColor: formKeyColor,
              trend: quickStats.formTrend,
            }
          : {
              value: quickStats.fitness ?? PLACEHOLDER,
              label: t('metrics.fitness'),
              keyColor: summarySeriesColor('fitness', isDark),
              trend: quickStats.fitnessTrend,
            };
    const heroId: MetricId =
      summaryCard.heroMetric === 'hrv' || summaryCard.heroMetric === 'form'
        ? summaryCard.heroMetric
        : 'fitness';
    return { ...hero, accessibilityLabel: describe(heroId, hero.value, hero.trend) };
  }, [summaryCard.heroMetric, quickStats, t, asPercent, formKeyColor, describe, isDark]);

  // Sparklines pulled from Rust (wellness persisted in SQLite via
  // `upsertWellness` in useWellness). Rust does the 30-day slice, CTL/ATL
  // coalescing, form as rounded ctl minus rounded atl, and HRV/RHR forward-fill in one round-trip.
  // The reader is keyed on the wellness generation and the refresh tick, so
  // the memo refreshes after each wellness sync and each pull-to-refresh.
  const readSparklines = useEngineRead([], [wellnessGeneration, refreshTick]);
  const sparklines = useMemo(() => {
    if (!summaryCard.showSparkline) return null;
    if (precomputedSparklines !== undefined) return precomputedSparklines;
    // The feed's bundle has not answered: draw no series rather than read a second time.
    if (awaitPrecomputed) return null;
    return (
      readSparklines((engine) => {
        if (!engine.getWellnessSparklines) return null;
        try {
          return engine.getWellnessSparklines(FEED_SPARKLINE_DAYS);
        } catch {
          // empty-on-error: sparklines under the card's headline numbers, which come from the startup bundle; the card draws without them.
          return null;
        }
      }) ?? null
    );
  }, [summaryCard.showSparkline, precomputedSparklines, awaitPrecomputed, readSparklines]);

  const fitnessData = sparklines?.fitness;
  const fitnessDelta = sparklines?.fitnessDelta ?? null;
  const fitnessRiseDays = sparklines?.fitnessRiseDays;
  const fatigueData = sparklines?.fatigue;
  const formData = sparklines?.form;
  const hrvData = sparklines?.hrv && sparklines.hrv.length > 0 ? sparklines.hrv : undefined;
  const rhrData = sparklines?.rhr && sparklines.rhr.length > 0 ? sparklines.rhr : undefined;
  // Which days of each series had a reading of their own, so a scrub onto a
  // carried day reads the absent mark. Only beside a series the card draws.
  const hrvRead = hrvData ? sparklines?.hrvRead : undefined;
  const rhrRead = rhrData ? sparklines?.rhrRead : undefined;

  // Format weight value with unit
  const formattedWeight = useMemo(() => {
    if (quickStats.weight === null) return PLACEHOLDER;
    return formatWeightCompact(quickStats.weight, isMetric);
  }, [quickStats.weight, isMetric]);

  // Build supporting metrics array from preferences
  const supportingMetrics = useMemo(() => {
    // Filter out weight when no data is available
    const metricIds = summaryCard.supportingMetrics
      .filter((id: MetricId) => id !== 'weight' || quickStats.weight !== null)
      .slice(0, 4);
    return metricIds.map((metricId: MetricId): SupportingMetric => {
      const shown = supportingMetric(metricId);
      return {
        ...shown,
        name: spokenOf(metricId).name,
        accessibilityLabel: describe(metricId, shown.value, shown.trend),
        navigationTarget: summaryCardTarget(metricId),
      };
    });

    function supportingMetric(
      metricId: MetricId
    ): Omit<SupportingMetric, 'name' | 'navigationTarget' | 'accessibilityLabel'> {
      switch (metricId) {
        case 'fitness':
          return {
            label: t('metrics.fitness'),
            value: quickStats.fitness ?? PLACEHOLDER,
            trend: quickStats.fitnessTrend,
          };
        case 'form':
          return {
            label: t('metrics.form'),
            value:
              (quickStats.form == null
                ? null
                : formatForm(quickStats.form, quickStats.fitness, asPercent)) ?? PLACEHOLDER,
            trend: quickStats.formTrend,
          };
        case 'hrv':
          return {
            label: t('metrics.hrv'),
            value: quickStats.hrv ?? PLACEHOLDER,
            unit: quickStats.hrv == null ? undefined : t('units.ms'),
            trend: quickStats.hrvTrend,
          };
        case 'rhr':
          return {
            label: t('metrics.rhr'),
            value: quickStats.rhr ?? PLACEHOLDER,
            unit: quickStats.rhr == null ? undefined : t('units.bpm'),
            trend: quickStats.rhrTrend,
          };
        case 'ftp':
          return {
            label: t('metrics.eftp'),
            value: quickStats.ftp ?? PLACEHOLDER,
            unit: quickStats.ftp == null ? undefined : t('units.watts'),
            trend: quickStats.ftpTrend,
          };
        case 'thresholdPace':
          return {
            label: t('metrics.pace'),
            value:
              quickStats.thresholdPace == null
                ? PLACEHOLDER
                : formatPaceCompact(quickStats.thresholdPace, isMetric),
            unit: quickStats.thresholdPace == null ? undefined : paceUnitLabel(isMetric),
            trend: quickStats.thresholdPaceTrend,
          };
        case 'css':
          return {
            label: t('metrics.css'),
            value: quickStats.css == null ? PLACEHOLDER : formatSwimPace(quickStats.css, isMetric),
            unit: quickStats.css == null ? undefined : swimPaceUnitLabel(isMetric),
            trend: quickStats.cssTrend,
          };
        case 'weekHours':
          return {
            label: t('metrics.week'),
            value: formatDurationHuman(quickStats.weekSeconds),
            trend: quickStats.weekHoursTrend,
          };
        case 'weekCount':
          return {
            label: '#',
            value: quickStats.weekCount,
            trend: quickStats.weekCountTrend,
          };
        case 'weight':
          return {
            label: '\u2696\uFE0F',
            value: formattedWeight,
            trend: quickStats.weightTrend,
          };
        default: {
          // Every `MetricId` has a case, so a new one fails to compile here.
          const unhandled: never = metricId;
          return { label: String(unhandled), value: PLACEHOLDER };
        }
      }
    }
  }, [
    summaryCard.supportingMetrics,
    quickStats,
    formattedWeight,
    isMetric,
    asPercent,
    t,
    describe,
    spokenOf,
  ]);

  // Stabilize references to prevent downstream re-renders when values are unchanged
  const stableHeroData = useStableValue(
    isLoading
      ? {
          ...heroData,
          value: PLACEHOLDER,
          trend: undefined,
        }
      : heroData
  );
  const stableFitnessData = useStableArray(fitnessData);
  const stableRiseDays = useStableArray(fitnessRiseDays);
  const stableFatigueData = useStableArray(fatigueData);
  const stableFormData = useStableArray(formData);
  const stableHrvData = useStableArray(hrvData);
  const stableRhrData = useStableArray(rhrData);
  const stableHrvRead = useStableArray(hrvRead);
  const stableRhrRead = useStableArray(rhrRead);
  const stableSupportingMetrics = useStableValue(
    isLoading
      ? supportingMetrics.map((metric) => ({
          ...metric,
          value: PLACEHOLDER,
          trend: undefined,
        }))
      : supportingMetrics
  );

  return useMemo(
    () => ({
      profileUrl,
      heroMetric: summaryCard.heroMetric,
      heroValue: stableHeroData.value,
      heroLabel: stableHeroData.label,
      heroKeyColor: stableHeroData.keyColor,
      heroZone:
        summaryCard.heroMetric === 'form' && formZone ? t(`formZones.${formZone}`) : undefined,
      heroTrend: stableHeroData.trend,
      heroAccessibilityLabel: stableHeroData.accessibilityLabel,
      fitnessData: stableFitnessData,
      fitnessDelta,
      fitnessRiseDays: stableRiseDays,
      fatigueData: stableFatigueData,
      formData: stableFormData,
      hrvData: stableHrvData,
      rhrData: stableRhrData,
      hrvRead: stableHrvRead,
      rhrRead: stableRhrRead,
      showSparkline: summaryCard.showSparkline,
      supportingMetrics: stableSupportingMetrics,
      isLoading,
      refetch,
    }),
    [
      profileUrl,
      summaryCard.heroMetric,
      stableHeroData,
      formZone,
      t,
      stableFitnessData,
      fitnessDelta,
      stableRiseDays,
      stableFatigueData,
      stableFormData,
      stableHrvData,
      stableRhrData,
      stableHrvRead,
      stableRhrRead,
      summaryCard.showSparkline,
      stableSupportingMetrics,
      isLoading,
      refetch,
    ]
  );
}
