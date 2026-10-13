/**
 * Scenario: the summary card prints the daily eFTP under the word the app uses
 * for the FTP setting, so an athlete with a 280 W setting and a 251 W estimate
 * read "FTP 251" and, one tap on, "280 W" for the same word.
 *
 * Expected behaviour: the card and its metric picker name the estimate.
 */

import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import {
  AVAILABLE_METRICS,
  useDashboardPreferences,
} from '@/features/settings/stores/summaryCardPreferences';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: [] }),
  getSettingsForSport: (_settings: unknown, sport: string) =>
    sport === 'Ride' ? { ftp: 280 } : undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: {} }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const BUNDLE = {
  wellness: {},
  currentWeek: { count: 0, totalDuration: 0 },
  prevWeek: { count: 0, totalDuration: 0 },
  ftpTrend: { latestFtp: 262, previousFtp: 255 },
  runPaceTrend: {},
  swimPaceTrend: {},
};

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
beforeEach(() => {
  useDashboardPreferences.setState({
    summaryCard: { ...DEFAULTS, supportingMetrics: ['ftp'] },
  });
});
afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

describe('the summary card power metric', () => {
  it('names the daily estimate it prints', () => {
    const { result } = renderHook(() => useSummaryCardData(BUNDLE, { awaitPrecomputed: true }));
    const [ftp] = result.current.supportingMetrics;

    expect(ftp.value).toBe(262);
    expect(ftp.label).toBe('metrics.eftp');
  });

  it('is offered in the picker under the same name', () => {
    const entry = AVAILABLE_METRICS.find((metric) => metric.id === 'ftp');

    expect(entry?.labelKey).toBe('metrics.eftp');
  });
});
