/**
 * Scenario: an activity's Sections tab, with and without sections.
 *
 * Expected behaviour: the tab offers no scan for further sections. The empty tab is the shared
 * EmptyState with no action, and a non-empty list ends without a scan button or nearby results.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: () => null,
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
jest.mock('@/shared/native/engine', () => ({ isEngineReady: () => true, getEngine: () => null }));

function renderTab(encounterCount: number) {
  const encounters = Array.from({ length: encounterCount }, (_, i) => ({
    sectionId: `s${i}`,
  }));
  return render(
    <ActivitySectionsSection
      activityId="a1"
      sportType="Ride"
      encounters={encounters as never}
      coordinates={[]}
      isDark={false}
      isMetric
      sectionCreationMode={false}
      cacheDays={30}
      highlightedSectionId={null}
      onHighlightedSectionIdChange={jest.fn()}
      onSectionCreationModeChange={jest.fn()}
      removeSection={jest.fn()}
    />
  );
}

describe('the activity Sections tab', () => {
  it('draws the empty state with no action when no sections exist', async () => {
    const screen = await renderTab(0);
    expect(screen.getByTestId('empty-state-title')).toBeTruthy();
    expect(screen.getByText('activityDetail.noMatchedSections')).toBeTruthy();
    expect(screen.queryByText('sections.scanForMatches')).toBeNull();
    expect(screen.queryByTestId('empty-state-action')).toBeNull();
  });

  it('draws no scan button or nearby results under a list of sections', async () => {
    const screen = await renderTab(1);
    expect(screen.queryByText('sections.scanForMore')).toBeNull();
    expect(screen.queryByText('sections.noMatchesFound')).toBeNull();
    expect(screen.queryByText(/sections\.nearbySectionsCount/)).toBeNull();
  });
});
