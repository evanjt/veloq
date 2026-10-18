/**
 * Scenario: the summary card judged critical speed, in m/s, against a polarity
 * written for minutes per kilometre, so a faster threshold pace or CSS drew a
 * decline. It also printed the swim setting's CSS, and a separate pace curve's
 * critical speed, beside an arrow and a widget that both read the measured
 * series, so a swimmer with a year-old setting of 1.25 m/s and a measured 1.35
 * saw 1:20 on the card and 1:14 on the widget.
 *
 * Expected behaviour: the card draws the arrow the engine judged, and prints
 * the measured value the arrow and the widget describe.
 */

import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { useDashboardPreferences } from '@/features/settings/stores/summaryCardPreferences';
import { formatPaceCompact, formatSwimPace } from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
const mockPaceCurve = jest.fn((_options: unknown) => ({ data: { criticalSpeed: 3.1 } }));
jest.mock('@/features/stats', () => ({ usePaceCurve: (o: unknown) => mockPaceCurve(o) }));
let mockMetric = true;
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockMetric }));

function card(run: object, swim: object) {
  return {
    wellness: {},
    currentWeek: { count: 0, totalDuration: 0 },
    prevWeek: { count: 0, totalDuration: 0 },
    ftpTrend: { latestFtp: null, previousFtp: null },
    runPaceTrend: run,
    swimPaceTrend: swim,
  };
}

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
beforeEach(() => {
  mockMetric = true;
  useDashboardPreferences.setState({
    summaryCard: { ...DEFAULTS, supportingMetrics: ['thresholdPace', 'css'] },
  });
});
afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

async function metrics(bundle: ReturnType<typeof card>) {
  const { result } = await renderHook(() => useSummaryCardData(bundle, { awaitPrecomputed: true }));
  const [pace, css] = result.current.supportingMetrics;
  return { pace, css };
}

describe('the pace arrows', () => {
  it('draw the glyph the engine judged, up for a faster pace', async () => {
    const { pace, css } = await metrics(
      card(
        { latestPace: 3.95, previousPace: 3.8, glyph: '↑' },
        { latestPace: 1.25, previousPace: 1.35, glyph: '↓' }
      )
    );

    expect(pace.trend).toBe('↑');
    expect(css.trend).toBe('↓');
  });

  it('draw flat for a move the engine called flat', async () => {
    const { pace } = await metrics(card({ latestPace: 3.83, previousPace: 3.8, glyph: '→' }, {}));

    expect(pace.trend).toBe('→');
  });

  it('draw nothing when the engine judged nothing', async () => {
    const { pace, css } = await metrics(card({}, {}));

    expect(pace.trend).toBeUndefined();
    expect(css.trend).toBeUndefined();
  });
});

describe('the pace values', () => {
  const RUN = { latestPace: 3.5, previousPace: 3.4, glyph: '↑' };
  const SWIM = { latestPace: 1.35, previousPace: 1.25, glyph: '↑' };

  it('print the measured critical speed the arrow describes, not the setting', async () => {
    const { pace, css } = await metrics(card(RUN, SWIM));

    expect(css.value).toBe(formatSwimPace(1.35, true));
    expect(pace.value).toBe(formatPaceCompact(3.5, true));
  });

  // The widget's entries are composed by the engine, whose tests pin the same
  // four strings for the same bundle, so the card and the widget agree through
  // them rather than through a shared call.
  it.each([
    [true, '4:46', '1:14'],
    [false, '7:40', '1:08'],
  ])(
    'print what the widget prints for the same bundle (metric %s)',
    async (isMetric, run, swim) => {
      mockMetric = isMetric;
      const { pace, css } = await metrics(card(RUN, SWIM));

      expect(pace.value).toBe(run);
      expect(css.value).toBe(swim);
    }
  );

  it('print a placeholder with no measured pace', async () => {
    const { pace, css } = await metrics(card({}, {}));

    expect(pace.value).toBe(ABSENT);
    expect(css.value).toBe(ABSENT);
  });
});
