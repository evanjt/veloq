import type {
  FfiFtpTrend,
  FfiPaceTrend,
  FfiPeriodStats,
  FfiSummaryCardData,
  FfiWellnessSummary,
} from 'veloqrs';

/** What a test says about the bundle: any field of any section, the rest left at its empty reading. */
export interface SummaryCardBundleOverrides {
  wellness?: FfiWellnessSummary;
  currentWeek?: Partial<FfiPeriodStats>;
  prevWeek?: Partial<FfiPeriodStats>;
  weekHoursTrend?: string;
  weekCountTrend?: string;
  ftpTrend?: Partial<FfiFtpTrend>;
  runPaceTrend?: Partial<FfiPaceTrend>;
  swimPaceTrend?: Partial<FfiPaceTrend>;
}

const emptyWeek = (): FfiPeriodStats => ({
  count: 0,
  totalDuration: 0,
  totalDistance: 0,
  totalTss: 0,
});

const emptyPace = (): FfiPaceTrend => ({ sampleCount: 0, history: [] });

/**
 * A complete summary card bundle in the engine's record shape: every section
 * present, no wellness reading, an empty week, no power or pace trend. Each
 * section in `overrides` replaces the fields it names.
 */
export function summaryCardBundle(overrides: SummaryCardBundleOverrides = {}): FfiSummaryCardData {
  const bundle: FfiSummaryCardData = {
    wellness: { ...overrides.wellness },
    currentWeek: { ...emptyWeek(), ...overrides.currentWeek },
    prevWeek: { ...emptyWeek(), ...overrides.prevWeek },
    ftpTrend: {
      lookbackDays: 0,
      sampleCount: 0,
      history: [],
      historyDays: [],
      changes: [],
      ...overrides.ftpTrend,
    },
    runPaceTrend: { ...emptyPace(), ...overrides.runPaceTrend },
    swimPaceTrend: { ...emptyPace(), ...overrides.swimPaceTrend },
  };
  if (overrides.weekHoursTrend !== undefined) bundle.weekHoursTrend = overrides.weekHoursTrend;
  if (overrides.weekCountTrend !== undefined) bundle.weekCountTrend = overrides.weekCountTrend;
  return bundle;
}
