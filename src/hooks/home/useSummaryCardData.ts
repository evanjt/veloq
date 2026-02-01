import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAthlete,
  useWellness,
  useSportSettings,
  getSettingsForSport,
  usePaceCurve,
  useInfiniteActivities,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  getLatestFTP,
} from '@/hooks';
import { useDashboardPreferences, useSportPreference, SPORT_COLORS } from '@/providers';
import type { MetricId } from '@/providers';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import { colors } from '@/theme';

/**
 * Supporting metric for SummaryCard display
 */
interface SupportingMetric {
  label: string;
  value: string | number;
  color?: string;
  trend?: '↑' | '↓' | '';
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

  // Sparkline
  sparklineData?: number[];
  showSparkline: boolean;

  // Supporting metrics
  supportingMetrics: SupportingMetric[];

  // State
  isLoading: boolean;

  // Actions
  refetch: () => Promise<void>;
}

/**
 * Hook that provides all data needed for SummaryCard.
 *
 * Extracts the data calculation logic from the home screen so it can be
 * reused in settings preview and other places that need the same data.
 *
 * Uses: useAthlete, useWellness, useSportSettings, usePaceCurve,
 * useInfiniteActivities, useDashboardPreferences, useSportPreference
 */
export function useSummaryCardData(): SummaryCardData {
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const { primarySport } = useSportPreference();
  const { data: sportSettings } = useSportSettings();
  const { summaryCard } = useDashboardPreferences();

  // Fetch pace curve for running threshold pace
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    enabled: primarySport === 'Running',
  });

  // Profile URL
  const profileUrl = athlete?.profile_medium || athlete?.profile;

  // Fetch activities for weekly stats and FTP
  const {
    data: activitiesData,
    isLoading: activitiesLoading,
    refetch: refetchActivities,
  } = useInfiniteActivities();

  const allActivities = useMemo(() => {
    if (!activitiesData?.pages) return [];
    return activitiesData.pages.flat();
  }, [activitiesData?.pages]);

  // Fetch wellness data for form, fitness, HRV
  const {
    data: wellnessData,
    isLoading: wellnessLoading,
    refetch: refetchWellness,
  } = useWellness('1m');

  // Combined loading state
  const isLoading = activitiesLoading || wellnessLoading;

  // Combined refresh handler
  const refetch = async () => {
    await Promise.all([refetchActivities(), refetchWellness()]);
  };

  // Compute quick stats from wellness and activities data
  const quickStats = useMemo(() => {
    // Get latest wellness data for form and HRV
    const sorted = wellnessData ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id)) : [];
    const latest = sorted[0];
    const previous = sorted[1];

    const fitness = Math.round(latest?.ctl ?? latest?.ctlLoad ?? 0);
    const fatigue = Math.round(latest?.atl ?? latest?.atlLoad ?? 0);
    const form = fitness - fatigue;
    const hrv = latest?.hrv ?? null;
    const rhr = latest?.restingHR ?? null;

    // Calculate previous day's values for trends
    const prevFitness = Math.round(previous?.ctl ?? previous?.ctlLoad ?? fitness);
    const prevFatigue = Math.round(previous?.atl ?? previous?.atlLoad ?? fatigue);
    const prevForm = prevFitness - prevFatigue;
    const prevHrv = previous?.hrv ?? hrv;
    const prevRhr = previous?.restingHR ?? rhr;

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

    const fitnessTrend = getTrend(fitness, prevFitness, 1);
    const formTrend = getTrend(form, prevForm, 2);
    const hrvTrend = getTrend(hrv, prevHrv, 2);
    const rhrTrend = getTrend(rhr, prevRhr, 1);

    // Pre-compute date boundaries
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekAgoTs = now - weekMs;
    const twoWeeksAgoTs = now - weekMs * 2;
    const thirtyDaysAgoTs = now - 30 * 24 * 60 * 60 * 1000;

    // Single-pass: Compute all activity-based metrics
    let weekCount = 0;
    let weekSeconds = 0;
    let prevWeekCount = 0;
    let prevWeekSeconds = 0;
    let latestFtp: number | null = null;
    let latestFtpDate = 0;
    let prevFtp: number | null = null;
    let prevFtpDate = 0;

    if (allActivities) {
      for (const activity of allActivities) {
        const activityTs = new Date(activity.start_date_local).getTime();

        // Current week stats
        if (activityTs >= weekAgoTs) {
          weekCount++;
          weekSeconds += activity.moving_time || 0;
        }
        // Previous week stats
        else if (activityTs >= twoWeeksAgoTs) {
          prevWeekCount++;
          prevWeekSeconds += activity.moving_time || 0;
        }

        // Track FTP values
        if (activity.icu_ftp) {
          if (activityTs > latestFtpDate) {
            latestFtpDate = activityTs;
            latestFtp = activity.icu_ftp;
          }
          if (activityTs <= thirtyDaysAgoTs && activityTs > prevFtpDate) {
            prevFtpDate = activityTs;
            prevFtp = activity.icu_ftp;
          }
        }
      }
    }

    const weekHours = Math.round((weekSeconds / 3600) * 10) / 10;
    const prevWeekHours = Math.round((prevWeekSeconds / 3600) * 10) / 10;

    const weekHoursTrend = getTrend(weekHours, prevWeekHours, 0.5);
    const weekCountTrend = getTrend(weekCount, prevWeekCount, 1);

    const ftp = latestFtp ?? getLatestFTP(allActivities) ?? null;
    const ftpTrend = getTrend(ftp, prevFtp ?? ftp, 3);

    return {
      fitness,
      fitnessTrend,
      form,
      formTrend,
      hrv,
      hrvTrend,
      rhr,
      rhrTrend,
      weekHours,
      weekHoursTrend,
      weekCount,
      weekCountTrend,
      ftp,
      ftpTrend,
    };
  }, [wellnessData, allActivities]);

  const formZone = getFormZone(quickStats.form);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : colors.success;

  // Build hero metric data based on summaryCard preferences
  const heroData = useMemo(() => {
    const metric = summaryCard.heroMetric;

    switch (metric) {
      case 'form':
        return {
          value: quickStats.form,
          label: t('metrics.form'),
          color: formColor,
          zoneLabel: formZone ? FORM_ZONE_LABELS[formZone] : undefined,
          zoneColor: formColor,
          trend: quickStats.formTrend,
        };
      case 'fitness':
        return {
          value: quickStats.fitness,
          label: t('metrics.fitness'),
          color: colors.fitnessBlue,
          zoneLabel: undefined,
          zoneColor: undefined,
          trend: quickStats.fitnessTrend,
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

  // Build sparkline data from wellness (last 30 days)
  const sparklineData = useMemo(() => {
    if (!summaryCard.showSparkline) return undefined;
    if (!wellnessData || wellnessData.length === 0) return undefined;

    const sorted = [...wellnessData].sort((a, b) => a.id.localeCompare(b.id)).slice(-30);

    switch (summaryCard.heroMetric) {
      case 'form':
        return sorted.map((w) => {
          const ctl = w.ctl ?? w.ctlLoad ?? 0;
          const atl = w.atl ?? w.atlLoad ?? 0;
          return ctl - atl;
        });
      case 'fitness':
        return sorted.map((w) => w.ctl ?? w.ctlLoad ?? 0);
      case 'hrv':
        return sorted.map((w) => w.hrv ?? 0);
      default:
        return undefined;
    }
  }, [wellnessData, summaryCard.heroMetric, summaryCard.showSparkline]);

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

  // Build supporting metrics array from preferences
  const supportingMetrics = useMemo(() => {
    return summaryCard.supportingMetrics.slice(0, 4).map((metricId: MetricId) => {
      switch (metricId) {
        case 'fitness':
          return {
            label: t('metrics.fitness'),
            value: quickStats.fitness,
            color: colors.fitnessBlue,
            trend: quickStats.fitnessTrend,
          };
        case 'form':
          return {
            label: t('metrics.form'),
            value: quickStats.form > 0 ? `+${quickStats.form}` : quickStats.form,
            color: formColor,
            trend: quickStats.formTrend,
          };
        case 'hrv':
          return {
            label: t('metrics.hrv'),
            value: quickStats.hrv ?? '-',
            color: colors.chartPink,
            trend: quickStats.hrvTrend,
          };
        case 'rhr':
          return {
            label: t('metrics.rhr'),
            value: quickStats.rhr ?? '-',
            color: undefined,
            trend: quickStats.rhrTrend,
          };
        case 'ftp':
          return {
            label: t('metrics.ftp'),
            value: quickStats.ftp ?? '-',
            color: SPORT_COLORS.Cycling,
            trend: quickStats.ftpTrend,
          };
        case 'thresholdPace':
          return {
            label: t('metrics.pace'),
            value: sportMetrics.thresholdPace ? formatPaceCompact(sportMetrics.thresholdPace) : '-',
            color: SPORT_COLORS.Running,
            trend: undefined,
          };
        case 'css':
          return {
            label: t('metrics.css'),
            value: sportMetrics.css ? formatSwimPace(sportMetrics.css) : '-',
            color: SPORT_COLORS.Swimming,
            trend: undefined,
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
        default:
          return {
            label: metricId,
            value: '-',
            color: undefined,
            trend: undefined,
          };
      }
    });
  }, [summaryCard.supportingMetrics, quickStats, formColor, sportMetrics, t]);

  return {
    profileUrl,
    heroValue: heroData.value,
    heroLabel: heroData.label,
    heroColor: heroData.color,
    heroZoneLabel: heroData.zoneLabel,
    heroZoneColor: heroData.zoneColor,
    heroTrend: heroData.trend,
    sparklineData,
    showSparkline: summaryCard.showSparkline,
    supportingMetrics,
    isLoading,
    refetch,
  };
}
