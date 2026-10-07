export {
  FitnessChart,
  FormZoneChart,
  ActivityDotsChart,
  SeasonBestsSection,
  ClimbingBestRows,
  ClimbingStatusNote,
  TimeRangeSelector,
  SportToggleSelector,
  FitnessHeaderStats,
  BestEffortsHeaderButton,
} from './components';

export {
  FitnessChartCard,
  PerformanceCurveSection,
  FitnessTrendSections,
} from './components/sections';

export {
  useZoneDistribution,
  useAthleteSummary,
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  useFitnessWindow,
  getISOWeekNumber,
  formatWeekRange,
  type WeeklySummaryData,
} from './hooks';

export {
  getFormZone,
  formatForm,
  formatEffortValue,
  formChartSeries,
  type FormChartPoint,
  FORM_ZONE_COLORS,
  FORM_ZONE_MARK_COLORS,
  FORM_ZONE_TEXT_COLORS,
  FORM_ZONE_TEXT_COLORS_DARK,
  formZoneTextColor,
  formZoneLabel,
  FORM_ZONE_BOUNDARIES,
  type FormZone,
} from './lib';

export {
  useSportPreference,
  initializeSportPreference,
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  SPORT_TEXT_COLORS_DARK,
  type PrimarySport,
} from './stores';
export { resolveThresholdPace } from './lib/thresholdPace';
export { currentAndPreviousWeek } from './lib/weekWindow';
