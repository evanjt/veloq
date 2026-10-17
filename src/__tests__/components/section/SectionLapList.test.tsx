import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { layout, opacity } from '@/theme';
import { SectionLapList } from '@/features/routes/components/section/SectionLapList';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

const mockTapTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  tapTo: (...args: unknown[]) => mockTapTo(...args),
}));

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
      isRecord: false,
    })),
    lapCount: starts.length,
    bestTime: 120,
    bestPace: 3,
    avgTime: 125,
    avgPace: 3,
    direction: 'same',
  } as SectionPerformanceRecord;
}

async function openAllRender(ui: React.ReactElement) {
  const utils = await render(ui);
  await fireEvent.press(utils.getByTestId('section-lap-show-all'));
  return utils;
}

describe('SectionLapList', () => {
  const records = [record('a', [40, 10]), record('b', [5])];

  it('titles the card as a heading', async () => {
    const { getByRole } = await render(
      <SectionLapList
        isDark={false}
        records={records}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByRole('header', { name: 'sections.laps' })).toBeTruthy();
  });

  it('leaves the title off when the screen around it already carries it', async () => {
    const { queryByRole, queryByText, getByTestId } = await render(
      <SectionLapList
        isDark={false}
        showTitle={false}
        records={records}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByTestId('section-lap-list')).toBeTruthy();
    expect(queryByRole('header')).toBeNull();
    expect(queryByText('sections.laps')).toBeNull();
  });

  it('lists lapped activities only, laps in track order, with an exclude each', async () => {
    const onExcludeLap = jest.fn();
    const { getByTestId, queryByTestId, getByText } = await openAllRender(
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
    await fireEvent.press(getByTestId('section-lap-exclude-a-40'));
    expect(onExcludeLap).toHaveBeenCalledWith('a', 40);
  });

  it('shows an excluded lap as excluded with an undo', async () => {
    const onIncludeLap = jest.fn();
    const { getByTestId, queryByTestId } = await openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [40, 10, 70], [10]), record('b', [5])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={onIncludeLap}
      />
    );
    expect(queryByTestId('section-lap-exclude-a-10')).toBeNull();
    expect(getByTestId('section-lap-exclude-a-40')).toBeTruthy();
    await fireEvent.press(getByTestId('section-lap-undo-a-10'));
    expect(onIncludeLap).toHaveBeenCalledWith('a', 10);
  });

  it('draws an excluded lap out of play at the dimmed step, and a counted lap at full strength', async () => {
    const { getByTestId } = await openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [40, 10], [10])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(StyleSheet.flatten(getByTestId('section-lap-row-a-10').props.style).opacity).toBe(
      opacity.dim
    );
    expect(
      StyleSheet.flatten(getByTestId('section-lap-row-a-40').props.style).opacity
    ).toBeUndefined();
  });

  it('keeps a two-lap activity listed after one lap is excluded, so it can be undone', async () => {
    const onIncludeLap = jest.fn();
    const { getByTestId } = await openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [10, 40], [40])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={onIncludeLap}
      />
    );
    expect(getByTestId('section-lap-row-a-10')).toBeTruthy();
    await fireEvent.press(getByTestId('section-lap-undo-a-40'));
    expect(onIncludeLap).toHaveBeenCalledWith('a', 40);
  });

  it('draws lap rows below the tap-target height and lifts the controls with hit slop', async () => {
    const { getByTestId } = await openAllRender(
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

  it('marks the lap the engine names as the record, and not a quicker partial lap', async () => {
    const withFragment = {
      ...record('a', [10, 40]),
    };
    withFragment.laps = [
      { ...withFragment.laps[0]!, time: 40, isRecord: false },
      { ...withFragment.laps[1]!, direction: 'same' as const, time: 95, isRecord: true },
    ];
    const { getByTestId, queryByTestId } = await openAllRender(
      <SectionLapList
        isDark={false}
        records={[withFragment, record('b', [5, 20])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByTestId('section-lap-record-a-40')).toBeTruthy();
    expect(queryByTestId('section-lap-record-a-10')).toBeNull();
    expect(queryByTestId('section-lap-record-b-5')).toBeNull();
    expect(queryByTestId('section-lap-record-b-20')).toBeNull();
  });

  it('renders nothing when no activity lapped the section', async () => {
    const { queryByTestId } = await render(
      <SectionLapList
        isDark={false}
        records={[record('b', [5])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(queryByTestId('section-lap-list')).toBeNull();
  });

  it('opens every lap on a dedicated page', async () => {
    const { getByTestId } = await render(
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

  it("shows a lap's stored mean watts, and nothing for a lap without power", async () => {
    const { getByText, queryByText } = await openAllRender(
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

  it('keeps the watts of an excluded lap', async () => {
    const { getByText } = await openAllRender(
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

    it('shows one row per activity with no exclude pill, and caps the rows', async () => {
      const { getByTestId, queryByTestId, queryAllByTestId } = await render(
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

    it('keeps the most recent activities and the activity holding the record lap', async () => {
      const holder = {
        ...many[0]!,
        laps: many[0]!.laps.map((l, i) => ({ ...l, isRecord: i === 0 })),
      };
      const { queryByTestId } = await render(
        <SectionLapList
          isDark={false}
          records={[holder, ...many.slice(1)]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      expect(queryByTestId('section-lap-summary-a')).toBeTruthy();
      expect(queryByTestId('section-lap-record-a')).toBeTruthy();
      expect(queryByTestId('section-lap-summary-f')).toBeTruthy();
      expect(queryByTestId('section-lap-summary-e')).toBeTruthy();
      expect(queryByTestId('section-lap-summary-b')).toBeNull();
    });

    it('keeps no activity for a quicker lap the engine does not call the record', async () => {
      // A fragment of the section is quick and never the record.
      const fragment = { ...many[0]!, laps: many[0]!.laps.map((l) => ({ ...l, time: 30 })) };
      const { queryByTestId } = await render(
        <SectionLapList
          isDark={false}
          records={[fragment, ...many.slice(1)]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      expect(queryByTestId('section-lap-summary-a')).toBeNull();
      expect(queryByTestId(/^section-lap-record-/)).toBeNull();
    });

    it('opens every lap with Show all and folds back', async () => {
      const { getByTestId, queryByTestId } = await render(
        <SectionLapList
          isDark={false}
          records={many}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      await fireEvent.press(getByTestId('section-lap-show-all'));
      expect(queryByTestId('section-lap-exclude-b-10')).toBeTruthy();
      await fireEvent.press(getByTestId('section-lap-show-fewer'));
      expect(queryByTestId('section-lap-exclude-b-10')).toBeNull();
    });

    it('still offers Show all for a single activity, since exclude lives in the full list', async () => {
      const { queryByTestId } = await render(
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

    it('speaks the best lap with its time, not the bare words', () => {
      const { getByLabelText } = render(
        <SectionLapList
          isDark={false}
          records={[record('a', [10, 40])]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      expect(getByLabelText('sections.bestLapValue:2:00')).toBeTruthy();
    });

    it('names the record on the trophy and on the row holding it', () => {
      const holder = {
        ...record('a', [10, 40]),
      };
      holder.laps = holder.laps.map((l, i) => ({ ...l, isRecord: i === 0 }));
      const { getByTestId } = render(
        <SectionLapList
          isDark={false}
          records={[holder]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      const mark = getByTestId('section-lap-record-a');
      expect(mark.props.accessible).toBe(true);
      expect(mark.props.accessibilityLabel).toBe('a11y.recordLap');
      const label = getByTestId('section-lap-summary-a').props.accessibilityLabel as string;
      expect(label).toMatch(
        /^Ride a, .+, a11y\.recordLap, sections\.bestLapValue:2:00, a11y\.laps:2$/
      );
    });

    it('speaks a row without the record without the record word', () => {
      const { getByTestId } = render(
        <SectionLapList
          isDark={false}
          records={[record('a', [10, 40])]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      const label = getByTestId('section-lap-summary-a').props.accessibilityLabel as string;
      expect(label).toMatch(/^Ride a, .+, sections\.bestLapValue:2:00, a11y\.laps:2$/);
      expect(label).not.toMatch(/recordLap/);
    });

    it('opens the activity from its summary row', () => {
      mockTapTo.mockClear();
      const { getByTestId } = render(
        <SectionLapList
          isDark={false}
          records={[record('a', [10, 40])]}
          onExcludeLap={jest.fn()}
          onIncludeLap={jest.fn()}
        />
      );
      const row = getByTestId('section-lap-summary-a');
      expect(row.props.accessibilityRole).toBe('button');
      fireEvent.press(row);
      expect(mockTapTo).toHaveBeenCalledWith('/activity/a');
    });
  });
});

/**
 * Scenario: a lap's exclude and undo each drew a pill of their own.
 *
 * Expected behaviour: each is the shared small Button, named for the lap it acts on.
 */
describe('SectionLapList lap actions', () => {
  it('draws exclude and undo as Buttons with their labels', async () => {
    const { getByTestId, getByRole, getByText } = await openAllRender(
      <SectionLapList
        isDark={false}
        records={[record('a', [40, 10], [10])]}
        onExcludeLap={jest.fn()}
        onIncludeLap={jest.fn()}
      />
    );
    expect(getByTestId('section-lap-exclude-a-40-label')).toHaveTextContent('sections.excludeLap');
    expect(getByRole('button', { name: 'sections.excludeLapNumber:2' })).toBe(
      getByTestId('section-lap-exclude-a-40')
    );
    expect(getByTestId('section-lap-undo-a-10-label')).toHaveTextContent('sections.undoExclude');
    expect(getByRole('button', { name: 'sections.undoExcludeLap:1' })).toBe(
      getByTestId('section-lap-undo-a-10')
    );
    expect(getByText('sections.lapExcluded')).toBeTruthy();
  });
});
