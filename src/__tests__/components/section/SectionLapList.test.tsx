import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { layout } from '@/theme';
import { SectionLapList } from '@/features/routes/components/section/SectionLapList';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

/**
 * One activity's laps as the screen read returns them: every lap, the ones the
 * athlete excluded flagged rather than dropped.
 */
function record(
  activityId: string,
  starts: number[],
  excluded: number[] = [],
  powers: (number | null)[] = []
): SectionPerformanceRecord {
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
      avgHr: null,
      avgPower: powers[i] ?? null,
      excluded: excluded.includes(s),
    })),
    lapCount: starts.length,
    bestTime: 120,
    bestPace: 3,
    avgTime: 125,
    avgPace: 3,
    direction: 'same',
  } as SectionPerformanceRecord;
}

function openAllRender(ui: React.ReactElement) {
  const utils = render(ui);
  fireEvent.press(utils.getByTestId('section-lap-show-all'));
  return utils;
}

describe('SectionLapList', () => {
  const records = [record('a', [40, 10]), record('b', [5])];

  it('lists lapped activities only, laps in track order, with an exclude each', () => {
    const onExcludeLap = jest.fn();
    const { getByTestId, queryByTestId, getByText } = openAllRender(
      <SectionLapList
        isDark={false}
        records={records}
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
    const { getByTestId, queryByTestId } = openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [40, 10, 70], [10]), record('b', [5])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={onIncludeLap}
      />
    );
    expect(queryByTestId('section-lap-exclude-a-10')).toBeNull();
    expect(getByTestId('section-lap-exclude-a-40')).toBeTruthy();
    fireEvent.press(getByTestId('section-lap-undo-a-10'));
    expect(onIncludeLap).toHaveBeenCalledWith('a', 10);
  });

  it('keeps a two-lap activity listed after one lap is excluded, so it can be undone', () => {
    const onIncludeLap = jest.fn();
    const { getByTestId } = openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [10, 40], [40])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={onIncludeLap}
      />
    );
    expect(getByTestId('section-lap-row-a-10')).toBeTruthy();
    fireEvent.press(getByTestId('section-lap-undo-a-40'));
    expect(onIncludeLap).toHaveBeenCalledWith('a', 40);
  });

  it('draws lap rows below the tap-target height and lifts the controls with hit slop', () => {
    const { getByTestId } = openAllRender(
      <SectionLapList
        isDark={false}
        records={records}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    const row = StyleSheet.flatten(getByTestId('section-lap-row-a-40').props.style);
    expect(row.minHeight ?? 0).toBeLessThan(layout.minTapTarget);
    expect(getByTestId('section-lap-exclude-a-40').props.hitSlop).toEqual(
      expect.objectContaining({ top: expect.any(Number), bottom: expect.any(Number) })
    );
  });

  it('renders nothing when no activity lapped the section', () => {
    const { queryByTestId } = render(
      <SectionLapList
        isDark={false}
        records={[record('b', [5])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(queryByTestId('section-lap-list')).toBeNull();
  });

  it('opens every lap on a dedicated page', () => {
    const { getByTestId } = render(
      <SectionLapList
        isDark={false}
        initiallyExpanded
        records={[record('a', [10, 40])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByTestId('section-lap-row-a-10')).toBeTruthy();
    expect(getByTestId('section-lap-row-a-40')).toBeTruthy();
  });

  it("shows a lap's stored mean watts, and nothing for a lap without power", () => {
    const { getByText, queryByText } = openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [10, 40, 70], [], [245.4, null, 0])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByText('245 W')).toBeTruthy();
    expect(queryByText(/ W$/, { exact: false })).toBe(getByText('245 W'));
    expect(queryByText('0 W')).toBeNull();
  });

  it('keeps the watts of an excluded lap', () => {
    const { getByText } = openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [10, 40], [40], [200, 310])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByText('310 W')).toBeTruthy();
  });
  describe('collapsed by default', () => {
    const many = [
      record('a', [10, 40]),
      record('b', [10, 40]),
      record('c', [10, 40]),
      record('d', [10, 40]),
      record('e', [10, 40]),
      record('f', [10, 40]),
    ].map((r, i) => ({ ...r, activityDate: new Date(Date.UTC(2026, 0, 1 + i)) }));

    it('shows one row per activity with no exclude pill, and caps the rows', () => {
      const { getByTestId, queryByTestId, queryAllByTestId } = render(
        <SectionLapList
          isDark={false}
          records={many}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      expect(queryAllByTestId(/^section-lap-summary-/).length).toBeLessThanOrEqual(4);
      expect(queryAllByTestId(/^section-lap-summary-/).length).toBeGreaterThan(0);
      expect(queryByTestId('section-lap-exclude-f-10')).toBeNull();
      expect(queryByTestId('section-lap-row-f-10')).toBeNull();
      expect(getByTestId('section-lap-show-all')).toBeTruthy();
    });

    it('keeps the most recent activities and the activity holding the best lap', () => {
      const best = { ...many[0]!, laps: many[0]!.laps.map((l) => ({ ...l, time: 60 })) };
      const { queryByTestId } = render(
        <SectionLapList
          isDark={false}
          records={[best, ...many.slice(1)]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      expect(queryByTestId('section-lap-summary-a')).toBeTruthy();
      expect(queryByTestId('section-lap-summary-f')).toBeTruthy();
      expect(queryByTestId('section-lap-summary-e')).toBeTruthy();
      expect(queryByTestId('section-lap-summary-b')).toBeNull();
    });

    it('opens every lap with Show all and folds back', () => {
      const { getByTestId, queryByTestId } = render(
        <SectionLapList
          isDark={false}
          records={many}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      fireEvent.press(getByTestId('section-lap-show-all'));
      expect(queryByTestId('section-lap-exclude-b-10')).toBeTruthy();
      fireEvent.press(getByTestId('section-lap-show-fewer'));
      expect(queryByTestId('section-lap-exclude-b-10')).toBeNull();
    });

    it('still offers Show all for a single activity, since exclude lives in the full list', () => {
      const { queryByTestId } = render(
        <SectionLapList
          isDark={false}
          records={[record('a', [10, 40])]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      expect(queryByTestId('section-lap-summary-a')).toBeTruthy();
      expect(queryByTestId('section-lap-show-all')).toBeTruthy();
    });
  });
});
