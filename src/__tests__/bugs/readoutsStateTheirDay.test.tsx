/**
 * Scenario: readouts that are not today's, or not on the clock the athlete
 * assumes, said otherwise. A ride from March labelled March's resting HR and
 * HRV "today". The fitness and form charts headed their newest stored row
 * "Current" whatever day it was. The eFTP milestone said its earlier value was
 * read 30 days ago when the engine takes the newest day at or before that.
 * Insight sheets printed section and route times with no word of which clock.
 *
 * Expected behaviour: each readout carries its own day, "Today" only when it
 * is, and every sheet that prints a time says what the time measures.
 */

import React from 'react';
import { fireEvent, render, renderHook } from '@testing-library/react-native';

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import { MethodologySection } from '@/features/insights/components/MethodologySection';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import type { Insight, InsightCategory, TFunc } from '@/features/insights/types';
import { formatEpochDayUtc, formatLocalDate, formatShortDate } from '@/shared/format/format';
import type { WellnessData } from '@/types';
import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const t = i18n.t.bind(i18n) as unknown as TFunc;

function textOf(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const { children } = node as { children?: unknown[] };
  return (children ?? []).flatMap(textOf);
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

afterEach(async () => {
  await changeLanguage('en-GB');
});

describe('the activity cards on a past activity', () => {
  const ride = activityRecord({
    id: 'march-ride',
    sportType: 'Ride',
    name: 'Harbour loop',
    startDateLocal: '2026-03-14T08:00:00',
    trainingLoad: 80,
    intensity: 75,
    avgHr: 142,
    maxHr: 171,
  });
  const marchWellness = {
    id: '2026-03-14',
    restingHR: 48,
    hrv: 62,
    ctl: 55,
    atl: 61,
  } as WellnessData;

  async function labels(): Promise<string[]> {
    const { result } = await renderHook(() =>
      useActivityStats({ activity: ride, wellness: marchWellness, isMetric: true, maxHR: 190 })
    );
    return result.current.stats.flatMap((card) => (card.details ?? []).map((d) => d.label));
  }

  it('dates no wellness value as today', async () => {
    const all = await labels();

    expect(all.filter((label) => /today/i.test(label))).toEqual([]);
  });

  it('says every wellness value is the activity day', async () => {
    const all = await labels();
    const dayValues = [
      t('activity.stats.restingHRThatDay'),
      t('activity.stats.hrvThatDay'),
      t('activity.stats.fitnessThatDay'),
      t('activity.stats.fatigueThatDay'),
    ];

    for (const label of dayValues) {
      expect(label).toMatch(/that day/);
      expect(all).toContain(label);
    }
  });
});

describe('the fitness chart header at rest', () => {
  // The suite's clock reads 17 June 2026.
  const endingThreeDaysAgo = [
    { id: '2026-06-12', ctl: 40, atl: 50 },
    { id: '2026-06-13', ctl: 41, atl: 49 },
    { id: '2026-06-14', ctl: 42, atl: 47 },
  ] as WellnessData[];
  // The charts read today on the local clock, which is the 18th at UTC+14.
  const endingToday = [
    ...endingThreeDaysAgo,
    { id: formatLocalDate(new Date()), ctl: 43, atl: 45 },
  ] as WellnessData[];

  it('names the newest row by its date when it is not today', async () => {
    const fitness = await render(<FitnessChart data={endingThreeDaysAgo} />);
    expect(fitness.getByTestId('fitness-chart-day')).toHaveTextContent(
      formatShortDate('2026-06-14'),
      { exact: true }
    );
  });

  it('reads Today when the newest row is today', async () => {
    const fitness = await render(<FitnessChart data={endingToday} />);
    expect(fitness.getByTestId('fitness-chart-day')).toHaveTextContent(t('time.today'), {
      exact: true,
    });
  });

  it('still names a pinned day by its date', async () => {
    const fitness = await render(<FitnessChart data={endingToday} selectedDate="2026-06-13" />);
    expect(fitness.getByTestId('fitness-chart-day')).toHaveTextContent(
      formatShortDate('2026-06-13'),
      { exact: true }
    );
  });
});

describe('the eFTP milestone sheet', () => {
  const DAY = 86_400;
  const latest = Date.UTC(2026, 5, 16) / 1000;
  // Thirty-two days back: the engine took the newest day at or before the
  // cutoff, and the 30th day had no row.
  const previous = latest - 32 * DAY;

  async function sheet(): Promise<string> {
    const [power] = generateFitnessMilestoneInsights(
      {
        latestFtp: 252,
        previousFtp: 238,
        deltaWatts: 14,
        latestDate: latest,
        previousDate: previous,
        sampleCount: 33,
      },
      null,
      null,
      latest * 1000,
      t
    );
    return textOf((await render(<FitnessMilestoneContent insight={power} />)).toJSON()).join(' ');
  }

  it('dates the two values it compares rather than claiming 30 days', async () => {
    const text = await sheet();

    expect(text).not.toMatch(/30 days/);
    expect(text).toContain(formatEpochDayUtc(previous));
    expect(text).toContain(formatEpochDayUtc(latest));
  });

  it.each(['de-DE', 'fr', 'ja'] as const)('dates both values in %s', async (locale) => {
    await changeLanguage(locale);
    const text = await sheet();

    expect(text).toContain(formatEpochDayUtc(previous));
    expect(text).toContain(formatEpochDayUtc(latest));
  });
});

describe('the method fold on an insight sheet that prints times', () => {
  function insight(category: InsightCategory): Insight {
    return {
      id: `${category}-quarry`,
      category,
      priority: 2,
      icon: 'trophy',
      iconTone: 'positive',
      title: 'Quarry Climb',
      timestamp: 0,
      isNew: false,
      methodology: { name: 'Method', description: 'How the card was found.' },
    } as Insight;
  }

  async function fold(category: InsightCategory): Promise<string> {
    const view = await render(<MethodologySection insight={insight(category)} />);
    await fireEvent.press(view.getByTestId('methodology-toggle'));
    return textOf(view.toJSON()).join(' ');
  }

  it.each(['section_pr', 'section_trend', 'stale_pr'] as const)(
    'says section times include stops on %s',
    async (category) => {
      expect(await fold(category)).toContain(t('sections.timeMethod'));
    }
  );

  it('says route times are moving time on a route card', async () => {
    const text = await fold('route');

    expect(text).toContain(t('routes.timeMethod'));
    expect(text).not.toContain(t('sections.timeMethod'));
  });

  it('says section times include stops when the rows carry section times', async () => {
    const summary = {
      ...insight('period_comparison'),
      supportingData: {
        sections: [{ sectionId: 'quarry', sectionName: 'Quarry Climb', bestTime: 372 }],
      },
    } as Insight;
    const view = await render(<MethodologySection insight={summary} />);
    await fireEvent.press(view.getByTestId('methodology-toggle'));

    expect(textOf(view.toJSON()).join(' ')).toContain(t('sections.timeMethod'));
  });

  it('names no clock on a card that prints no time', async () => {
    const text = await fold('fitness_milestone');

    expect(text).not.toContain(t('sections.timeMethod'));
    expect(text).not.toContain(t('routes.timeMethod'));
  });
});
