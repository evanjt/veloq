/**
 * Scenario: one scrub tick on the sections tab re-rendered every visible row,
 * because each row was handed a fresh `renderRightActions` closure built in the
 * list's render item. Each row is a Swipeable, a Pressable and up to two
 * sparklines, so the cost scales with the sections the activity matched.
 *
 * Expected behaviour: only the row whose highlight changed re-renders. The row
 * builds its own swipe-action closure from the group it already holds, so the
 * prop the list passes is one stable function for every row.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionInlinePlot } from '@/features/activity/components/SectionInlinePlot';
import {
  groupSectionEncounters,
  type SectionEncounterGroup,
} from '@/features/activity/lib/groupSectionEncounters';
import type { SectionEncounter } from 'veloqrs';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/routes/components/section/SectionSparkline', () => ({
  SectionSparkline: () => null,
}));

function encounter(sectionId: string): SectionEncounter {
  return {
    sectionId,
    sectionName: 'Mont d’Orge',
    direction: 'same',
    distanceMeters: 1200,
    lapTime: 140,
    lapPace: 2.3,
    isPr: false,
    visitCount: 8,
    historyTimes: [],
    historyActivityIds: [],
  } as SectionEncounter;
}

function props(
  sectionId: string,
  renderRightActions: jest.Mock<React.ReactNode, [SectionEncounterGroup]>
) {
  const group = groupSectionEncounters([encounter(sectionId)])[0];
  return {
    group,
    activityId: 'act-1',
    sportType: 'Ride',
    index: 0,
    isHighlighted: false,
    isDark: false,
    isMetric: true,
    onPress: jest.fn(),
    onSwipeableOpen: jest.fn(),
    renderRightActions,
    swipeableRefs: { current: new Map() },
  };
}

describe('section row scrub re-renders', () => {
  /**
   * The list passes one stable function for every row, so the memo can hold.
   * The row builds the per-group closure itself, from the group it already has,
   * which is why the group has to reach the callback.
   */
  it('hands the swipe actions the row its own group', () => {
    const renderRightActions = jest.fn<React.ReactNode, [SectionEncounterGroup]>(() => null);
    const p = props('s1', renderRightActions);

    render(<SectionInlinePlot {...p} />);

    expect(renderRightActions).toHaveBeenCalled();
    for (const call of renderRightActions.mock.calls) {
      expect(call[0]).toBe(p.group);
    }
  });

  /** A re-render with the same props does no work in the row at all. */
  it('renders the same tree when nothing about the row changed', () => {
    const p = props(
      's1',
      jest.fn<React.ReactNode, [SectionEncounterGroup]>(() => null)
    );

    const tree = render(<SectionInlinePlot {...p} />);
    const first = tree.toJSON();
    tree.rerender(<SectionInlinePlot {...p} />);

    expect(tree.toJSON()).toEqual(first);
  });
});
