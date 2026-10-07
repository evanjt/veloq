/**
 * Scenario: an out-and-back section with forward climbs at 9:10, 9:30 and
 * 9:45 and one reverse descent at 5:40 ridden last. The sheet marked the
 * descent PR and gave every climb a delta against it.
 *
 * Expected behaviour: a record is marked PR only when the engine judges it
 * one in its own direction, and an effort's delta is against the best of its
 * own direction.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RecentEffortsList } from '@/features/insights/components/content/RecentEffortsList';
import type { DirectionBests } from '@/features/insights/lib/directionBests';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

function record(
  id: string,
  day: number,
  bestTime: number,
  direction: 'same' | 'reverse' = 'same'
): SectionPerformanceRecord {
  return {
    activityId: id,
    activityName: id,
    activityDate: new Date(Date.UTC(2026, 5, day)),
    laps: [],
    lapCount: 1,
    bestTime,
    bestPace: 1000 / bestTime,
    bestForwardTime: direction === 'same' ? bestTime : null,
    bestReverseTime: direction === 'reverse' ? bestTime : null,
    direction,
  } as unknown as SectionPerformanceRecord;
}

const climbBest = record('c1', 1, 550);
const records = [
  climbBest,
  record('c2', 2, 570),
  record('c3', 3, 585),
  record('descent', 4, 340, 'reverse'),
];

describe('the recent efforts list', () => {
  it('leaves a lone reverse descent unmarked and measures each climb within its direction', () => {
    const bests: DirectionBests = {
      forward: climbBest,
      reverse: records[3],
      forwardIsPr: true,
      reverseIsPr: false,
    };
    const { queryAllByText, getByText } = render(
      <RecentEffortsList records={records} bests={bests} />
    );

    expect(queryAllByText('sections.legendPr')).toHaveLength(1);
    getByText('+0:20');
    getByText('+0:35');
    expect(queryAllByText(/^\+3:/)).toHaveLength(0);
  });

  it('marks both directions when each holds a record, and a descent has no delta of its own', () => {
    const slower = record('descent2', 5, 400, 'reverse');
    const bests: DirectionBests = {
      forward: climbBest,
      reverse: records[3],
      forwardIsPr: true,
      reverseIsPr: true,
    };
    const { queryAllByText, getByText } = render(
      <RecentEffortsList records={[...records, slower]} bests={bests} />
    );

    expect(queryAllByText('sections.legendPr')).toHaveLength(2);
    getByText('+1:00');
  });

  it('splits an out-and-back into a forward effort and a reverse effort, each with its own verdict', () => {
    const outAndBack = {
      ...record('x', 6, 450, 'same'),
      bestForwardTime: 450,
      bestReverseTime: 400,
    } as SectionPerformanceRecord;
    const forwardBest = record('f', 1, 430);
    const reverseBest = {
      ...record('x', 6, 400, 'reverse'),
      bestForwardTime: 450,
      bestReverseTime: 400,
    } as SectionPerformanceRecord;
    const bests: DirectionBests = {
      forward: forwardBest,
      reverse: reverseBest,
      forwardIsPr: true,
      reverseIsPr: true,
    };
    const { queryAllByText, getByText } = render(
      <RecentEffortsList records={[forwardBest, outAndBack]} bests={bests} />
    );

    getByText('6:40');
    getByText('7:30');
    getByText('+0:20');
    expect(queryAllByText('sections.legendPr')).toHaveLength(2);
  });

  it('shows no cross-direction delta for a record whose first-direction lap has no time', () => {
    const reverseOnly = record('r', 7, 400, 'reverse');
    const bests: DirectionBests = {
      forward: climbBest,
      reverse: null,
      forwardIsPr: true,
      reverseIsPr: false,
    };
    const { queryAllByText, getByText } = render(
      <RecentEffortsList records={[climbBest, reverseOnly]} bests={bests} />
    );

    getByText('6:40');
    expect(queryAllByText(/^\+/)).toHaveLength(0);
  });
});
