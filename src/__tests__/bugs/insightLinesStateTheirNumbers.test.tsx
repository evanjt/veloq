/**
 * Scenario: a record set yesterday, a heart rate that fell 6 bpm at average
 * pace, and a Today banner over five sections of which four hold a record from
 * this week.
 *
 * Expected behaviour: the record line joins its parts with a middle dot and
 * names the day in words, the improving efficiency line carries the sign of
 * its change rather than reading as a heart rate of 6 bpm, and the banner
 * counts all four records rather than the ones it has room to show.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { createInstance } from 'i18next';
import type { EfficiencyTrend } from 'veloqrs';

import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import type { SectionPR } from '@/features/insights/types';
import type { WorkoutSection } from '@/features/home';
import { TodayBanner } from '@/features/routes/components/TodayBanner';
import { TIME } from '@/shared/app/time';
import enGB from '@/i18n/locales/en-GB.json';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

let mockT: (key: string, params?: Record<string, unknown>) => string = (key) => key;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    i18n: { language: 'en-GB' },
    t: (key: string, params?: Record<string, unknown>) => mockT(key, params),
  }),
}));

jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({
    todayWorkout: {
      id: 1,
      name: 'Hill repeats',
      day: '2026-01-02',
      sport: 'Run',
      movingTime: 3600,
      lines: [],
      bar: [],
    },
    tomorrowWorkout: null,
    isLoading: false,
  }),
}));

let mockSections: WorkoutSection[] = [];

jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: mockSections }),
}));

const t = (key: string, params?: Record<string, unknown>) => mockT(key, params);

beforeAll(async () => {
  const instance = createInstance();
  await instance.init({
    lng: 'en-GB',
    resources: { 'en-GB': { translation: enGB } },
    interpolation: { escapeValue: false },
  });
  const translate = instance.t as unknown as (key: string, params?: object) => string;
  mockT = (key, params) => translate(key, params);
});

describe('the section record subtitle', () => {
  const record: SectionPR = {
    sectionId: 'quarry-lane',
    sectionName: 'Quarry Lane',
    bestTime: 312,
    daysAgo: 1,
    sportType: 'Run',
    traversalCount: 9,
  };

  it('joins the time and the day with a middle dot and names the day', () => {
    const [insight] = generateSectionPRInsights([record], Date.now(), t);

    expect(insight.subtitle).not.toContain(' - ');
    expect(insight.subtitle).not.toMatch(/\dd ago/);
    expect(insight.subtitle).toBe('5:12 · Yesterday');
  });

  it('names a record set today', () => {
    const [insight] = generateSectionPRInsights([{ ...record, daysAgo: 0 }], Date.now(), t);

    expect(insight.subtitle).toBe('5:12 · Today');
  });

  it('dates the day from the moment the bundle was read', () => {
    const now = Date.now() + 3 * TIME.DAY;
    const [insight] = generateSectionPRInsights([{ ...record, daysAgo: 3 }], now, t);

    expect(insight.subtitle).toBe('5:12 · Today');
  });
});

describe('the efficiency subtitle', () => {
  function trend(overrides: Partial<EfficiencyTrend>): EfficiencyTrend {
    return {
      sectionId: 'quarry-lane',
      sectionName: 'Quarry Lane',
      sportType: 'Run',
      points: [],
      trendSlope: -0.0004,
      direction: 0,
      hrChangeBpm: -6.2,
      effortCount: 6,
      ...overrides,
    } as EfficiencyTrend;
  }

  it('signs a fall when efficiency improves', () => {
    const [insight] = generateEfficiencyTrendInsights([trend({})], Date.now(), t);

    expect(insight.subtitle).toMatch(/[-−]6 bpm/);
    expect(insight.body).toMatch(/[-−]6 bpm/);
  });

  it('signs a rise once when efficiency worsens', () => {
    const [insight] = generateEfficiencyTrendInsights(
      [trend({ direction: 2, hrChangeBpm: 6.2, trendSlope: 0.0004 })],
      Date.now(),
      t
    );

    expect(insight.title).toContain('+6 bpm');
    expect(insight.subtitle).toContain('+6 bpm');
    expect(insight.body).toContain('+6 bpm');
    expect(`${insight.title}${insight.subtitle}${insight.body}`).not.toContain('++');
  });

  it('carries the same signed value on its data row', () => {
    const [improving] = generateEfficiencyTrendInsights([trend({})], Date.now(), t);
    const row = improving.supportingData?.dataPoints?.find((point) => point.key === 'hrChange');

    expect(row?.value).toMatch(/^[-−]6$/);
  });
});

describe('the Today banner record count', () => {
  function section(id: string, prDaysAgo: number | null): WorkoutSection {
    return {
      id,
      name: `Lane ${id}`,
      prTimeSecs: prDaysAgo == null ? null : 300,
      previousBestTimeSecs: null,
      lastTimeSecs: 320,
      daysSinceLast: 2,
      prDaysAgo,
      trend: null,
    };
  }

  it('counts every recent record the banner holds, not the rows it shows', async () => {
    mockSections = [
      section('a', 1),
      section('b', 2),
      section('c', 40),
      section('d', 3),
      section('e', 5),
    ];

    const { getByText } = await render(<TodayBanner form={null} />);

    expect(getByText('4 section PRs this week')).toBeTruthy();
  });

  it('counts one record kept out of sight by the row limit', async () => {
    mockSections = [section('a', 30), section('b', 31), section('c', 32), section('d', 1)];

    const { getByText } = await render(<TodayBanner form={null} />);

    expect(getByText('1 section PR this week')).toBeTruthy();
  });
});
