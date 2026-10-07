/**
 * Scenario: Section 63 crossed forward and back filled cards 1 and 2 on the
 * activity Sections tab, so one section carried two index numbers.
 *
 * Expected behaviour: one card per section, one index, and a row per
 * direction inside it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionInlinePlot } from '@/features/activity/components/SectionInlinePlot';
import { groupSectionEncounters } from '@/features/activity/lib/groupSectionEncounters';
import type { SectionEncounter } from 'veloqrs';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/features/routes/components/section/SectionSparkline', () => ({
  SectionSparkline: () => null,
}));

function encounter(overrides: Partial<SectionEncounter> & { sectionId: string }): SectionEncounter {
  return {
    sectionType: 'auto',
    sectionName: 'Mont d’Orge',
    direction: 'same',
    distanceMeters: 1200,
    startIndex: 0,
    lapTime: 140,
    lapPace: 2.3,
    isPr: false,
    isComplete: true,
    visitCount: 8,
    historyTimes: [],
    historyActivityIds: [],
    ...overrides,
  };
}

function renderGroup(encounters: SectionEncounter[], index = 0, sportType = 'Ride') {
  const [group] = groupSectionEncounters(encounters);
  return render(
    <SectionInlinePlot
      group={group}
      activityId="act-1"
      sportType={sportType}
      index={index}
      isHighlighted={false}
      isDark={false}
      isMetric
      onPress={jest.fn()}
      onSwipeableOpen={jest.fn()}
      renderRightActions={() => null}
      swipeableRefs={{ current: new Map() }}
    />
  );
}

describe('SectionInlinePlot', () => {
  it('shows the engine pace for a run even when distance and time imply another pace', () => {
    const { getByText } = renderGroup(
      [encounter({ sectionId: 'sec-pace', distanceMeters: 1000, lapTime: 100, lapPace: 2.5 })],
      0,
      'Run'
    );

    expect(getByText('6:40 /km')).toBeTruthy();
  });

  it('shows the engine pace per 100 metres for a swim', () => {
    const { getByText } = renderGroup(
      [encounter({ sectionId: 'sec-swim', distanceMeters: 100, lapTime: 100, lapPace: 2.5 })],
      0,
      'Swim'
    );

    expect(getByText('0:40 /100m')).toBeTruthy();
  });

  it('keeps elapsed time for a ride', () => {
    const { getByText } = renderGroup([
      encounter({ sectionId: 'sec-ride', lapTime: 140, lapPace: 2.5 }),
    ]);

    expect(getByText('2:20')).toBeTruthy();
  });

  it('shows one index and one name for a section crossed both ways', () => {
    const { getAllByText, queryByText } = renderGroup([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);

    expect(getAllByText('1')).toHaveLength(1);
    expect(getAllByText('Mont d’Orge')).toHaveLength(1);
    expect(queryByText('2')).toBeNull();
  });

  it('marks each direction inside the card', () => {
    const { getByText } = renderGroup([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);

    expect(getByText('→')).toBeTruthy();
    expect(getByText('↩')).toBeTruthy();
  });

  it('leaves a single forward crossing unmarked', () => {
    const { queryByText } = renderGroup([encounter({ sectionId: 'sec-70' })]);

    expect(queryByText('→')).toBeNull();
    expect(queryByText('↩')).toBeNull();
  });

  it('marks a single reverse crossing, which is not the default direction', () => {
    const { getByText } = renderGroup([encounter({ sectionId: 'sec-70', direction: 'reverse' })]);

    expect(getByText('↩')).toBeTruthy();
  });

  it('gives each direction its own trophy, so one PR does not claim both', () => {
    const { queryByTestId } = renderGroup([
      encounter({ sectionId: 'sec-63', direction: 'same', isPr: true }),
      encounter({ sectionId: 'sec-63', direction: 'reverse', isPr: false }),
    ]);

    expect(queryByTestId('section-inline-trophy-0')).toBeTruthy();
    expect(queryByTestId('section-inline-trophy-0-1')).toBeNull();
  });

  it.each([
    [2, 'sections.placeSecond'],
    [3, 'sections.placeThird'],
  ])('marks place %i beside the trophy slot with its label', (rank, label) => {
    const { getByTestId, queryByTestId } = renderGroup([
      encounter({ sectionId: 'sec-podium', rank }),
    ]);

    expect(getByTestId('section-inline-place-0').props.accessibilityLabel).toBe(label);
    expect(queryByTestId('section-inline-trophy-0')).toBeNull();
  });

  it.each([4, undefined])('draws no place mark for rank %s', (rank) => {
    const { queryByTestId } = renderGroup([
      encounter({ sectionId: 'sec-podium', ...(rank === undefined ? {} : { rank }) }),
    ]);

    expect(queryByTestId('section-inline-place-0')).toBeNull();
  });

  it('labels an under-coverage pass without a trophy', () => {
    const { getByTestId, queryByTestId } = renderGroup([
      encounter({ sectionId: 'sec-short', isComplete: false, isPr: true }),
    ]);

    expect(getByTestId('section-inline-partial-0')).toBeTruthy();
    expect(queryByTestId('section-inline-trophy-0')).toBeNull();
  });

  it('does not label a complete pass as partial', () => {
    const { queryByTestId } = renderGroup([encounter({ sectionId: 'sec-full' })]);
    expect(queryByTestId('section-inline-partial-0')).toBeNull();
  });

  it('shows neither direction nor visits for a partial-direction pass', () => {
    const { getByTestId, queryByText } = renderGroup([
      encounter({ sectionId: 'sec-short', direction: 'partial', isComplete: false, visitCount: 0 }),
    ]);

    expect(getByTestId('section-inline-partial-0')).toBeTruthy();
    expect(queryByText('→')).toBeNull();
    expect(queryByText('↩')).toBeNull();
    expect(queryByText(/0 routes.visits/)).toBeNull();
  });

  it('reports the whole card height once, not one height per direction', () => {
    const onRowHeight = jest.fn();
    const [group] = groupSectionEncounters([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);
    const { getByTestId } = render(
      <SectionInlinePlot
        group={group}
        activityId="act-1"
        index={2}
        isHighlighted={false}
        isDark={false}
        isMetric
        onPress={jest.fn()}
        onSwipeableOpen={jest.fn()}
        onRowHeight={onRowHeight}
        renderRightActions={() => null}
        swipeableRefs={{ current: new Map() }}
      />
    );

    getByTestId('section-inline-plot-2').props.onLayout({
      nativeEvent: { layout: { height: 94 } },
    });

    expect(onRowHeight).toHaveBeenCalledTimes(1);
    expect(onRowHeight).toHaveBeenCalledWith(2, 94);
  });
});
