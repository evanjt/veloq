/**
 * Scenario: an athlete who reads form as a share of fitness opens the fitness
 * and insights pages. The engine sends form per day in that unit, the zone
 * edges, the period's total load, the eFTP days and the load line.
 *
 * Expected behaviour: the panes draw exactly what the read sends, with edges
 * the page does not hold, the percent unit on every form figure, the eFTP
 * estimates on the days the engine names, and no line of its own over the dots.
 */

import { act, create } from 'react-test-renderer';

import { Chart } from '../../../web/connect/charts/Chart';
import {
  EftpPanel,
  LoadDots,
  LoadsPanel,
  Tiles,
  WellnessPanel,
} from '../../../web/connect/pages/FitnessPane';
import { TodayStrip } from '../../../web/connect/pages/InsightsPane';
import type { Methods } from '../../../web/connect/schema';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: 'en-GB' },
  }),
}));

type Wellness = Methods['fitness.wellness']['result'];
type Loads = Methods['fitness.loads']['result'];
type Screen = Methods['fitness.screen']['result'];

const day = (date: string, ctl: number | null, atl: number | null) => ({
  date,
  ctl,
  atl,
  rampRate: null,
  hrv: null,
  restingHr: null,
  weight: null,
  sleepSecs: null,
  sleepScore: null,
  soreness: null,
  fatigue: null,
  stress: null,
  mood: null,
  motivation: null,
  sportLoad: [],
  source: null,
});

const PERCENT_WELLNESS: Wellness = {
  days: [day('2026-03-01', 80, 60), day('2026-03-02', 100, 70), day('2026-03-03', 0, 10)],
  coverage: 'loaded',
  form: [25, 30, null],
  formAsPercent: true,
  formZoneEdges: [-20, -5, 10, 30],
};

function mount(element: React.ReactElement) {
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(element);
  });
  return root;
}

const chartOf = (element: React.ReactElement) => mount(element).root.findByType(Chart).props;
const textOf = (element: React.ReactElement) => JSON.stringify(mount(element).toJSON());

describe('the fitness chart', () => {
  it('plots the form the engine sends and bands it at the edges the engine sends', () => {
    const props = chartOf(<WellnessPanel data={PERCENT_WELLNESS} at={null} onAt={() => {}} />);

    expect(props.series[2].values).toEqual([25, 30, null]);
    expect(props.series[2].name).toBe('connectPage.facts.form (%)');
    expect(props.bands.map((b: { from: number; to: number }) => [b.from, b.to])).toEqual([
      [-1000, -20],
      [-20, -5],
      [-5, 10],
      [10, 30],
      [30, 1000],
    ]);
  });

  it('names the form line plainly when the athlete reads absolute form', () => {
    const absolute: Wellness = { ...PERCENT_WELLNESS, formAsPercent: false };
    const props = chartOf(<WellnessPanel data={absolute} at={null} onAt={() => {}} />);
    expect(props.series[2].name).toBe('connectPage.facts.form');
  });
});

describe('the fitness tiles', () => {
  const settled: Wellness = {
    ...PERCENT_WELLNESS,
    days: PERCENT_WELLNESS.days.slice(0, 2),
    form: [25, 30],
  };

  it('print the latest day as a percentage under the percentage unit', () => {
    const text = textOf(<Tiles data={settled} />);
    expect(text).toContain('30.0%');
    expect(text).not.toContain('40.0');
  });

  it('print absolute form without a percent sign when the athlete reads it so', () => {
    const text = textOf(<Tiles data={{ ...settled, formAsPercent: false }} />);
    expect(text).toContain('30.0');
    expect(text).not.toContain('30.0%');
  });

  it('print no form for a latest day that has none, rather than another unit', () => {
    const text = textOf(<Tiles data={PERCENT_WELLNESS} />);
    expect(text).not.toContain('connectPage.facts.form');
  });
});

describe('the period total', () => {
  it('prints the total the engine sends, not a sum of the bars', () => {
    const loads: Loads = {
      days: [
        { date: '2026-03-01', status: 'complete', total: 40, activityCount: 1 },
        { date: '2026-03-02', status: 'complete', total: 25, activityCount: 1 },
      ],
      total: 1234.4,
    };
    expect(textOf(<LoadsPanel data={loads} />)).toContain('{\\"load\\":1234}');
  });
});

describe('the eFTP chart', () => {
  it('places each estimate on the day the engine names, whatever the stamp reads as', () => {
    const screen = {
      ftpTrendCoverage: 'loaded',
      ftpTrend: {
        history: [
          { value: 250, date: 0, activityId: null },
          { value: 255, date: 86_400, activityId: null },
        ],
        historyDays: ['2026-03-03', '2026-03-04'],
      },
    } as unknown as Screen;

    const props = chartOf(<EftpPanel data={screen} />);

    expect(props.categories).toEqual(['2026-03-03', '2026-03-04']);
    expect(props.x.values).toEqual([Date.parse('2026-03-03'), Date.parse('2026-03-04')]);
  });
});

describe('the strip of activities by load', () => {
  const dots: Screen['loadDots'] = [
    {
      activityId: 'a',
      name: 'a',
      sportType: 'Ride',
      family: 'ride',
      startDateLocal: '2026-09-01T07:00:00',
      movingTime: 3600,
      distance: 0,
      load: 10,
    },
    {
      activityId: 'b',
      name: 'b',
      sportType: 'Ride',
      family: 'ride',
      startDateLocal: '2026-09-03T07:00:00',
      movingTime: 3600,
      distance: 0,
      load: 30,
    },
  ];

  it('draws the line the engine fitted, over the date axis', () => {
    const line = { originDay: '2026-09-01', slopePerDay: 10, intercept: 10, spread: 2 };

    const { trend } = chartOf(<LoadDots dots={dots} trend={line} open={null} onOpen={() => {}} />);

    const at = (when: string) => trend.intercept + trend.slope * Date.parse(when);
    expect(at('2026-09-03')).toBeCloseTo(30, 6);
    expect(trend.spread).toBe(2);
  });

  it('draws no line when the engine sent none, rather than fitting its own', () => {
    const { trend } = chartOf(<LoadDots dots={dots} trend={null} open={null} onOpen={() => {}} />);
    expect(trend).toBeNull();
  });
});

describe('the insights page', () => {
  const form = (value: number | null, formAsPercent: boolean) => ({
    date: '2026-03-03',
    ctl: 80,
    atl: 60,
    form: value,
    formAsPercent,
  });

  it("prints today's form as the engine reads it, with the percent unit", () => {
    expect(
      textOf(<TodayStrip form={form(25.4, true)} planned={[]} today="2026-03-03" />)
    ).toContain('25%');
  });

  it('prints absolute form with no unit, and a dash for a day with none', () => {
    const absolute = textOf(<TodayStrip form={form(20, false)} planned={[]} today="2026-03-03" />);
    expect(absolute).toContain('20');
    expect(absolute).not.toContain('20%');
    expect(
      textOf(<TodayStrip form={form(null, true)} planned={[]} today="2026-03-03" />)
    ).toContain('–');
  });
});
