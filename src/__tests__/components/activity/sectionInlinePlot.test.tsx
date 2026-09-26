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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/routes/components/section/SectionSparkline', () => ({
  SectionSparkline: () => null,
}));

function encounter(overrides: Partial<SectionEncounter> & { sectionId: string }): SectionEncounter {
  return {
    sectionName: 'Mont d’Orge',
    direction: 'same',
    distanceMeters: 1200,
    lapTime: 140,
    lapPace: 2.3,
    isPr: false,
    visitCount: 8,
    historyTimes: [],
    historyActivityIds: [],
    ...overrides,
  };
}

function renderGroup(encounters: SectionEncounter[], index = 0) {
  const [group] = groupSectionEncounters(encounters);
  return render(
    <SectionInlinePlot
      group={group}
      activityId="act-1"
      sportType="Ride"
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
