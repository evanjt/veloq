import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionLapList } from '@/features/routes/components/section/SectionLapList';
import { lapKey } from '@/features/routes/hooks/useSectionLaps';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

function record(activityId: string, starts: number[]): SectionPerformanceRecord {
  return {
    activityId,
    activityName: `Ride ${activityId}`,
    activityDate: new Date('2026-08-01T00:00:00Z'),
    laps: starts.map((s, i) => ({
      id: `${activityId}-${s}`,
      activityId,
      time: 120 + i * 10,
      pace: 3,
      distance: 300,
      direction: i === 1 ? ('reverse' as const) : ('same' as const),
      startIndex: s,
      endIndex: s + 30,
    })),
    lapCount: starts.length,
    bestTime: 120,
    bestPace: 3,
    avgTime: 125,
    avgPace: 3,
    direction: 'same',
  } as SectionPerformanceRecord;
}

describe('SectionLapList', () => {
  const records = [record('a', [40, 10]), record('b', [5])];

  it('lists lapped activities only, laps in track order, with an exclude each', () => {
    const onExcludeLap = jest.fn();
    const { getByTestId, queryByTestId, getByText } = render(
      <SectionLapList
        isDark={false}
        records={records}
        excludedLaps={new Set()}
        onExcludeLap={onExcludeLap}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByTestId('section-lap-list')).toBeTruthy();
    expect(queryByTestId('section-lap-row-b-5')).toBeNull();
    expect(getByText('sections.lap:1 · sections.reverse')).toBeTruthy();
    expect(getByText('sections.lap:2')).toBeTruthy();
    fireEvent.press(getByTestId('section-lap-exclude-a-40'));
    expect(onExcludeLap).toHaveBeenCalledWith('a', 40);
  });

  it('shows an excluded lap as excluded with an undo', () => {
    const onIncludeLap = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <SectionLapList
        isDark={false}
        records={records}
        excludedLaps={new Set([lapKey('a', 10)])}
        onExcludeLap={jest.fn()}
        onIncludeLap={onIncludeLap}
      />
    );
    expect(queryByTestId('section-lap-exclude-a-10')).toBeNull();
    fireEvent.press(getByTestId('section-lap-undo-a-10'));
    expect(onIncludeLap).toHaveBeenCalledWith('a', 10);
  });

  it('renders nothing when no activity lapped the section', () => {
    const { queryByTestId } = render(
      <SectionLapList
        isDark={false}
        records={[record('b', [5])]}
        excludedLaps={new Set()}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(queryByTestId('section-lap-list')).toBeNull();
  });
});
