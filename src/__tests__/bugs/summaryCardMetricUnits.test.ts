/**
 * Scenario: the summary card's row read 'HRV 52 · RHR 48 · FTP 262 · Pace 7:40'
 * with no unit on any of them, so an imperial runner could not tell a pace per
 * mile from one per kilometre.
 *
 * Expected behaviour: each supporting metric carries the unit it is read in,
 * the pace one following the athlete's unit preference, and a placeholder
 * carries none.
 */

import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { useDashboardPreferences } from '@/features/settings/stores/summaryCardPreferences';
import { formatDurationHuman } from '@/shared/format/format';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: [] }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: null }) }));
let mockMetric = true;
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockMetric }));

const BUNDLE = {
  wellness: { hrv: 52, rhr: 48 },
  currentWeek: { count: 0, totalDuration: 0 },
  prevWeek: { count: 0, totalDuration: 0 },
  ftpTrend: { latestFtp: 262, previousFtp: 255 },
  runPaceTrend: { latestPace: 3.5, previousPace: 3.4, glyph: '↑' },
  swimPaceTrend: { latestPace: 1.35, previousPace: 1.25, glyph: '↑' },
};

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
afterEach(() => {
  mockMetric = true;
  useDashboardPreferences.setState({ summaryCard: DEFAULTS });
});

function metrics(bundle: object, ids: string[]) {
  useDashboardPreferences.setState({
    summaryCard: { ...DEFAULTS, supportingMetrics: ids as never },
  });
  const { result } = renderHook(() => useSummaryCardData(bundle, { awaitPrecomputed: true }));
  return result.current.supportingMetrics;
}

describe('the summary card supporting metrics', () => {
  it('give HRV, resting heart rate and power their units', () => {
    const [hrv, rhr, ftp] = metrics(BUNDLE, ['hrv', 'rhr', 'ftp']);

    expect(hrv).toMatchObject({ value: 52, unit: 'units.ms' });
    expect(rhr).toMatchObject({ value: 48, unit: 'units.bpm' });
    expect(ftp).toMatchObject({ value: 262, unit: 'units.watts' });
  });

  it('read the threshold pace and CSS per mile and per 100 yards when imperial', () => {
    mockMetric = false;
    const [pace, css] = metrics(BUNDLE, ['thresholdPace', 'css']);

    expect(`${pace.value}${pace.unit}`).toBe('7:40/mi');
    expect(`${css.value}${css.unit}`).toBe('1:08/100yd');
  });

  it('read them per kilometre and per 100 metres when metric', () => {
    const [pace, css] = metrics(BUNDLE, ['thresholdPace', 'css']);

    expect(pace.unit).toBe('/km');
    expect(css.unit).toBe('/100m');
  });

  it('give a placeholder no unit', () => {
    const empty = { ...BUNDLE, wellness: {}, ftpTrend: {}, runPaceTrend: {}, swimPaceTrend: {} };
    for (const metric of metrics(empty, ['hrv', 'rhr', 'ftp', 'thresholdPace'])) {
      expect(metric.unit).toBeUndefined();
    }
  });

  it('write the week total as hours and minutes, not decimal hours', () => {
    const week = { ...BUNDLE, currentWeek: { count: 4, totalDuration: 23400 } };
    const [hours] = metrics(week, ['weekHours']);

    expect(hours.value).toBe(formatDurationHuman(23400));
    expect(hours.value).not.toBe('6.5h');
  });
});
