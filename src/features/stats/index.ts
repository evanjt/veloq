export {
  PowerCurveChart,
  PaceCurveChart,
  SwimPaceCurveChart,
  ZoneDistributionChart,
  FTPTrendChart,
  WeeklySummary,
  ActivityHeatmap,
  SeasonComparison,
  DecouplingChart,
  CurveFreshnessLine,
} from './components';
export type { ActivityHeatmapHandle } from './components';

export {
  usePaceCurve,
  getIndexAtDistance,
  getTimeAtDistance,
  usePowerCurve,
  getIndexAtDuration,
  useSeasonBests,
  bestEffortsOf,
  climbBestsOf,
  climbStatusOf,
  type ClimbStatus,
  useBestEfforts,
  type BestEffort,
  type ClimbBest,
  type BestEffortsSport,
  type UseSeasonBestsResult,
} from './hooks';

export {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
  formatScrubValue,
  seriesAverage,
  type DataSeries,
  type SeriesInfo,
  type ChartMetricValue,
  type ChartDataResult,
  type IntervalBand,
  type BandColourToken,
  resolveBandColour,
  computeTimeAxisLabels,
  axisLabelsNeedDay,
  curveFreshness,
  type CurveFreshness,
} from './lib';
export {
  BEST_EFFORTS_DEFAULT_PERIOD,
  BEST_EFFORTS_PERIODS,
  bestEffortsDays,
} from './lib/bestEffortsPeriod';
