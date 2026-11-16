/**
 * Scenario: the fitness tab stacks moving hours per week by sport family. The
 * engine's screen read holds the weeks, and the read carries no activity dots
 * here, so the chart cannot be drawn from anything but the series.
 *
 * Expected behaviour: one category per week the read holds, one series per
 * family with hours in any week, named and coloured by the engine's family,
 * a week without a family reading zero for it.
 */

import { act, create } from 'react-test-renderer';

import { Chart } from '../../../web/connect/charts/Chart';
import { WeeklyHours } from '../../../web/connect/pages/FitnessPane';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

const WEEKS = [
  { weekStart: '2026-08-17', hours: [{ family: 'run', hours: 0.5 }] },
  { weekStart: '2026-08-24', hours: [] },
  {
    weekStart: '2026-08-31',
    hours: [
      { family: 'ride', hours: 2 },
      { family: 'winter', hours: 1.25 },
    ],
  },
];

function chartOf(weeks: Parameters<typeof WeeklyHours>[0]['weeks']) {
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(<WeeklyHours weeks={weeks} />);
  });
  return root.root.findByType(Chart).props;
}

describe('the weekly hours chart', () => {
  it('draws the weeks and families the read holds', () => {
    const props = chartOf(WEEKS);
    expect(props.categories).toEqual(['2026-08-17', '2026-08-24', '2026-08-31']);
    expect(props.tickLabels).toEqual(['Aug', null, null]);
    expect(props.series).toEqual([
      {
        name: 'connectPage.families.run',
        colour: 'var(--colour-sport-run)',
        values: [0.5, 0, 0],
      },
      {
        name: 'connectPage.families.ride',
        colour: 'var(--colour-sport-ride)',
        values: [0, 0, 2],
      },
      {
        name: 'connectPage.families.winter',
        colour: 'var(--colour-sport-winter)',
        values: [0, 0, 1.25],
      },
    ]);
  });

  it('draws an empty chart for a read with no weeks', () => {
    const props = chartOf([]);
    expect(props.categories).toEqual([]);
    expect(props.series).toEqual([]);
  });
});
