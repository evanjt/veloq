/**
 * Scenario: an arrow beside a summary card number compares it with an earlier
 * reading, the day before for most metrics and a week before for weight, and
 * the card never said which reading or what the arrow meant. The widget beside
 * it printed the earlier value from the same engine read. The week and FTP
 * arrows were also judged a second time in TypeScript.
 *
 * Expected behaviour: each metric's label names what its arrow means and the
 * reading it was judged against, from the engine's own baseline, and every
 * arrow drawn is the one the engine judged.
 */

import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import {
  useDashboardPreferences,
  type MetricId,
} from '@/features/settings/stores/summaryCardPreferences';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const DAY = 86_400;
/** Midnight UTC on 8 October 2026, the way the engine dates a wellness day. */
const OCT_8 = 1_791_417_600;

const CARD = {
  wellness: {
    fitness: 62,
    fitnessTrend: '↑',
    fitnessPrevious: 60,
    fitnessPreviousDate: OCT_8,
    form: 10,
    formTrend: '↓',
    formPrevious: 14,
    formPreviousDate: OCT_8,
    hrv: 52,
    hrvTrend: '↑',
    hrvPrevious: 48,
    hrvPreviousDate: OCT_8,
    rhr: 47,
    // Resting heart rate fell, which the engine judged an improvement.
    rhrTrend: '↑',
    rhrPrevious: 50,
    rhrPreviousDate: OCT_8,
    weight: 71.2,
    weightTrend: '↓',
    weightPrevious: 72,
    weightPreviousDate: OCT_8 - 6 * DAY,
  },
  currentWeek: { count: 4, totalDuration: 7200 },
  prevWeek: { count: 2, totalDuration: 3600 },
  weekHoursTrend: '↑',
  weekCountTrend: '↑',
  ftpTrend: { latestFtp: 250, previousFtp: 240, previousDate: OCT_8 - 30 * DAY, glyph: '↑' },
  runPaceTrend: {},
  swimPaceTrend: {},
};

type Card = typeof CARD;

const DEFAULTS = useDashboardPreferences.getState().summaryCard;

function showing(heroMetric: 'fitness' | 'form' | 'hrv', supportingMetrics: MetricId[]) {
  useDashboardPreferences.setState({
    summaryCard: { ...DEFAULTS, heroMetric, showSparkline: false, supportingMetrics },
  });
}

async function cardData(card: Card) {
  const { result } = await renderHook(() => useSummaryCardData(card, { awaitPrecomputed: true }));
  return result.current;
}

/** The card defers its sparklines until the first frame's interactions finish. */
async function renderCard(props: Omit<SummaryCardProps, 'onProfilePress'>) {
  const tree = await render(<SummaryCard onProfilePress={() => {}} {...props} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

describe('a supporting metric label', () => {
  it('names the earlier HRV reading and the day it was read', async () => {
    showing('fitness', ['hrv']);

    const tree = await renderCard(await cardData(CARD));

    expect(tree.getByTestId('summary-card-metric-0').props.accessibilityLabel).toBe(
      'Heart rate variability 52, improved. Compared with 48 on 8 Oct.'
    );
  });

  it('says improved for a resting heart rate that fell', async () => {
    showing('fitness', ['rhr']);

    expect((await cardData(CARD)).supportingMetrics[0].accessibilityLabel).toBe(
      'Resting heart rate 47, improved. Compared with 50 on 8 Oct.'
    );
  });

  it('says which way weight went, in the athlete units, against the week before', async () => {
    showing('fitness', ['weight']);

    expect((await cardData(CARD)).supportingMetrics[0].accessibilityLabel).toBe(
      'Weight 71.2kg, falling. Compared with 72kg on 2 Oct.'
    );
  });

  it('compares the week with the same part of the week before', async () => {
    showing('fitness', ['weekHours', 'weekCount']);

    const [hours, count] = (await cardData(CARD)).supportingMetrics;

    expect(hours.accessibilityLabel).toBe(
      'Week 2 hours, improved. Compared with 1 hour at this point last week.'
    );
    expect(count.accessibilityLabel).toBe(
      'Activities 4, improved. Compared with 2 at this point last week.'
    );
  });

  it('names the eFTP estimate the step was measured from', async () => {
    showing('fitness', ['ftp']);

    expect((await cardData(CARD)).supportingMetrics[0].accessibilityLabel).toBe(
      'eFTP 250, improved. Compared with 240 on 8 Sept.'
    );
  });

  it('states only the value when the engine named no baseline', async () => {
    showing('fitness', ['hrv']);
    const card = {
      ...CARD,
      wellness: { ...CARD.wellness, hrvPrevious: undefined, hrvPreviousDate: undefined },
    } as unknown as Card;

    expect((await cardData(card)).supportingMetrics[0].accessibilityLabel).toBe(
      'Heart rate variability 52'
    );
  });

  it('states only the value when there is no arrow to explain', async () => {
    showing('fitness', ['hrv']);
    const card = {
      ...CARD,
      wellness: { ...CARD.wellness, hrvTrend: undefined },
    } as unknown as Card;

    expect((await cardData(card)).supportingMetrics[0].accessibilityLabel).toBe(
      'Heart rate variability 52'
    );
  });

  it('speaks the name alone, never the dash, for a metric with no reading', async () => {
    showing('fitness', ['ftp']);
    const card = { ...CARD, ftpTrend: {} } as unknown as Card;

    const tree = await renderCard(await cardData(card));

    expect(tree.getByTestId('summary-card-metric-0').props.accessibilityLabel).toBe('eFTP');
  });

  it('speaks only the name, not its glyph, while the values load', async () => {
    showing('fitness', ['weekCount']);

    const tree = await renderCard({ ...(await cardData(CARD)), isLoading: true });

    expect(tree.getByTestId('summary-card-metric-0').props.accessibilityLabel).toBe('Activities');
  });
});

describe('the hero label', () => {
  it('names the earlier reading when the hero is a number and its arrow', async () => {
    showing('form', []);

    const tree = await renderCard(await cardData(CARD));

    expect(tree.getByLabelText('Form +10, falling. Compared with +14 on 8 Oct.')).toBeTruthy();
  });
});

describe('the arrows the card draws', () => {
  it('are the week and FTP arrows the engine judged, not a second judgement', async () => {
    showing('fitness', ['weekHours', 'weekCount', 'ftp']);
    // Each of these moves is past its deadband on the raw numbers, so an arrow
    // re-judged here would differ from the one the engine sent.
    const card = { ...CARD, weekHoursTrend: '→', weekCountTrend: '↓' } as Card;
    card.ftpTrend = { ...CARD.ftpTrend, glyph: '→' };

    const trends = (await cardData(card)).supportingMetrics.map((m) => m.trend);

    expect(trends).toEqual(['→', '↓', '→']);
  });

  it('draws no week or FTP arrow the engine did not send', async () => {
    showing('fitness', ['weekHours', 'weekCount', 'ftp']);
    const card = {
      ...CARD,
      weekHoursTrend: undefined,
      weekCountTrend: undefined,
      ftpTrend: { latestFtp: 250 },
    } as unknown as Card;

    const trends = (await cardData(card)).supportingMetrics.map((m) => m.trend);

    expect(trends).toEqual([undefined, undefined, undefined]);
  });
});
