/**
 * Scenario: the athlete taps the ninth section's marker on the activity map,
 * and the Sections tab opens on a list of twelve.
 *
 * Expected behaviour: the list scrolls that section's card to the middle and
 * marks it for the hold duration, then clears the mark and reports the focus
 * handled so a second tap on the same marker scrolls again.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';
import { duration } from '@/theme';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: () => null,
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

// Twelve sections, the third crossed both ways, so it draws one card and the
// card index is not the encounter index.
function encounters() {
  const list = Array.from({ length: 12 }, (_, i) => ({
    sectionId: `trail-${i}`,
    direction: 'same',
  }));
  list.splice(3, 0, { sectionId: 'trail-2', direction: 'reverse' });
  return list;
}

function renderList(props: {
  focusSectionId: string | null;
  onHighlightedSectionIdChange?: jest.Mock;
  onFocusHandled?: jest.Mock;
}) {
  const element = (focusSectionId: string | null) => (
    <ActivitySectionsSection
      activityId="a1"
      sportType="Ride"
      encounters={encounters() as never}
      coordinates={[]}
      isDark={false}
      isMetric
      sectionCreationMode={false}
      cacheDays={30}
      highlightedSectionId={null}
      onHighlightedSectionIdChange={props.onHighlightedSectionIdChange ?? jest.fn()}
      onSectionCreationModeChange={jest.fn()}
      removeSection={jest.fn()}
      scanMatches={[]}
      hasScanned={false}
      onScan={jest.fn()}
      onRematch={jest.fn()}
      focusSectionId={focusSectionId}
      onFocusHandled={props.onFocusHandled ?? jest.fn()}
    />
  );
  const screen = render(element(props.focusSectionId));
  return { ...screen, focus: (id: string | null) => screen.rerender(element(id)) };
}

describe('a section marker tap brings its card into view', () => {
  let scrollToIndex: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
  });

  afterEach(() => {
    scrollToIndex.mockRestore();
    jest.useRealTimers();
  });

  it('scrolls the tapped section card to the middle of the list', () => {
    renderList({ focusSectionId: 'trail-9' });
    act(() => jest.runOnlyPendingTimers());
    expect(scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 9, viewPosition: 0.5 })
    );
  });

  it('counts a section crossed both ways as one card', () => {
    renderList({ focusSectionId: 'trail-4' });
    act(() => jest.runOnlyPendingTimers());
    expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 4 }));
  });

  it('marks the card for the hold duration, then clears the mark', () => {
    const onHighlightedSectionIdChange = jest.fn();
    renderList({ focusSectionId: 'trail-9', onHighlightedSectionIdChange });
    expect(onHighlightedSectionIdChange).toHaveBeenLastCalledWith('trail-9');

    act(() => jest.advanceTimersByTime(duration.hold - 1));
    expect(onHighlightedSectionIdChange).not.toHaveBeenCalledWith(null);

    act(() => jest.advanceTimersByTime(1));
    expect(onHighlightedSectionIdChange).toHaveBeenLastCalledWith(null);
  });

  it('reports the focus handled so the same marker can be tapped again', () => {
    const onFocusHandled = jest.fn();
    const screen = renderList({ focusSectionId: 'trail-9', onFocusHandled });
    act(() => jest.runOnlyPendingTimers());
    expect(onFocusHandled).toHaveBeenCalledTimes(1);

    screen.focus(null);
    screen.focus('trail-9');
    act(() => jest.runOnlyPendingTimers());
    expect(onFocusHandled).toHaveBeenCalledTimes(2);
    expect(scrollToIndex.mock.calls.filter(([arg]) => arg.index === 9).length).toBe(2);
  });

  it('does nothing for a section the list does not hold, and waits for it', () => {
    const onFocusHandled = jest.fn();
    const onHighlightedSectionIdChange = jest.fn();
    renderList({ focusSectionId: 'trail-99', onFocusHandled, onHighlightedSectionIdChange });
    act(() => jest.runOnlyPendingTimers());
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(onHighlightedSectionIdChange).not.toHaveBeenCalled();
    expect(onFocusHandled).not.toHaveBeenCalled();
  });

  it('scrolls nowhere without a focus', () => {
    renderList({ focusSectionId: null });
    act(() => jest.runOnlyPendingTimers());
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
