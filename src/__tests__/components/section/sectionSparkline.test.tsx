/**
 * Scenario: the inline section sparkline spread its attempts evenly whatever
 * their dates, printed no values, and marked this activity in the light-theme
 * teal in both themes.
 *
 * Expected behaviour: attempts sit at the dates the engine carries, this
 * activity is marked by the reticle in the primary text colour of the theme
 * on screen, and the plot prints its low and high and speaks them.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';
import type { TFunction } from 'i18next';
import type { SectionEncounter } from 'veloqrs';

import { sectionSparklineData } from '@/features/activity/components/SectionInlinePlot';
import { SectionSparkline } from '@/features/routes/components/section/SectionSparkline';
import { chartStroke } from '@/shared/charts/chartMarks';
import { colors, darkColors } from '@/theme';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme,
}));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockScheme === 'dark' }),
}));

beforeEach(() => {
  jest
    .spyOn(Skia.Path, 'MakeFromSVGString')
    .mockReturnValue({} as ReturnType<typeof Skia.Path.MakeFromSVGString>);
});

afterEach(() => {
  mockScheme = 'light';
  jest.restoreAllMocks();
});

const DAY = 86_400;
const START = 1_700_000_000;
const t = ((key: string) => key) as unknown as TFunction;

function encounter(overrides: Partial<SectionEncounter> = {}): SectionEncounter {
  return {
    sectionId: 'sec-orchard',
    sectionType: 'auto',
    sectionName: 'Orchard Lane',
    direction: 'same',
    distanceMeters: 1000,
    startIndex: 0,
    lapTime: 200,
    lapPace: 5,
    isPr: false,
    isComplete: true,
    visitCount: 3,
    historyTimes: [250, 200, 220],
    historyActivityIds: ['act-a', 'act-b', 'act-c'],
    historyDates: [START, START + DAY, START + 31 * DAY],
    ...overrides,
  };
}

describe('sectionSparklineData', () => {
  it('carries each attempt at its date, so a month-long gap is not one step', () => {
    const data = sectionSparklineData(encounter(), 'act-b', 'Ride', true, t);

    expect(data?.points.map((p) => p.date)).toEqual([START, START + DAY, START + 31 * DAY]);
    expect(data?.points.map((p) => p.value)).toEqual([4, 5, 1000 / 220]);
  });

  it('marks this activity among the attempts', () => {
    expect(sectionSparklineData(encounter(), 'act-b', 'Ride', true, t)?.highlightIndex).toBe(1);
    expect(
      sectionSparklineData(encounter(), 'act-elsewhere', 'Ride', true, t)?.highlightIndex
    ).toBeUndefined();
  });

  it('keeps the dates aligned when the window slides to the current attempt', () => {
    const times = [300, 290, 280, 270, 260, 250, 240];
    const data = sectionSparklineData(
      encounter({
        historyTimes: times,
        historyActivityIds: times.map((_, i) => `act-${i}`),
        historyDates: times.map((_, i) => START + i * DAY),
      }),
      'act-1',
      'Ride',
      true,
      t
    );

    expect(data?.points.map((p) => p.date)).toEqual([0, 1, 2, 3, 4].map((i) => START + i * DAY));
    expect(data?.highlightIndex).toBe(1);
  });

  it('has nothing to draw for a single attempt', () => {
    const one = encounter({
      historyTimes: [200],
      historyActivityIds: ['act-b'],
      historyDates: [START],
    });

    expect(sectionSparklineData(one, 'act-b', 'Ride', true, t)).toBeUndefined();
  });
});

describe.each(['light', 'dark'] as const)('SectionSparkline, %s', (scheme) => {
  async function drawn() {
    mockScheme = scheme;
    const data = sectionSparklineData(encounter(), 'act-b', 'Ride', true, t)!;
    return render(
      <SectionSparkline
        testID="orchard-sparkline"
        points={data.points}
        name={data.name}
        format={data.format}
        summary={data.summary}
        highlightIndex={data.highlightIndex}
        width={80}
        height={32}
      />
    );
  }

  it('marks this activity with the reticle in the primary text colour', async () => {
    const view = await drawn();
    const ink = scheme === 'dark' ? darkColors.textPrimary : colors.textPrimary;

    const ticks = view.UNSAFE_queryAllByProps({ color: ink, strokeWidth: chartStroke.ring });
    expect(ticks.filter((tick) => tick.props.p1 !== undefined)).toHaveLength(4);
  });

  it('prints the slowest and fastest attempt beside the plot', async () => {
    const view = await drawn();

    const range = view.getByTestId('orchard-sparkline-range', { includeHiddenElements: true });
    expect(range).toHaveTextContent('18.0 km/h14.4 km/h');
  });

  it('speaks the sentence it was given', async () => {
    const view = await drawn();

    expect(view.getByTestId('orchard-sparkline').props.accessibilityLabel).toBe(
      'charts.summary.series'
    );
  });
});
