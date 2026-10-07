/**
 * Scenario: the athlete scans an activity and the engine returns no matches.
 *
 * Expected behaviour: the tab says nothing matched and the scan button is gone.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: () => null,
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

function renderScan(hasScanned: boolean, encounterCount: number) {
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
      scanMatches={[]}
      hasScanned={hasScanned}
      onScan={jest.fn()}
      onRematch={jest.fn()}
    />
  );
}

describe('a scan that finds nothing', () => {
  it('hides the scan button and says nothing matched when no sections exist', () => {
    const screen = renderScan(true, 0);
    expect(screen.queryByText('sections.scanForMatches')).toBeNull();
    expect(screen.getByText('sections.noMatchesFound')).toBeTruthy();
  });

  it('hides the scan link and says nothing matched when sections exist', () => {
    const screen = renderScan(true, 1);
    expect(screen.queryByText('sections.scanForMore')).toBeNull();
    expect(screen.getByText('sections.noMatchesFound')).toBeTruthy();
  });

  it('offers the scan before one has run', () => {
    const screen = renderScan(false, 0);
    expect(screen.getByText('sections.scanForMatches')).toBeTruthy();
  });
});
