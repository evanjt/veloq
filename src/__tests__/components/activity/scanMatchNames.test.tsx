/**
 * Scenario: the athlete named a detected section, then scans an activity that
 * detection has not attached yet. The engine answers the scan with the name
 * it resolves for each section.
 *
 * Expected behaviour: the scan row shows the name the engine sent, and no
 * name TypeScript computes for the same section replaces it.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { SectionMatch } from 'veloqrs';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';
import * as sectionDisplayNames from '@/features/routes/lib/sectionDisplayNames';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: () => null,
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

function scanMatch(sectionId: string, sectionName: string | undefined): SectionMatch {
  return {
    sectionId,
    sectionName,
    startIndex: 0,
    endIndex: 40,
    matchQuality: 0.95,
    sameDirection: true,
    distanceMeters: 1200,
  } as SectionMatch;
}

function renderScan(matches: SectionMatch[]) {
  return render(
    <ActivitySectionsSection
      activityId="a1"
      sportType="Ride"
      encounters={[]}
      coordinates={[]}
      isDark={false}
      isMetric
      sectionCreationMode={false}
      cacheDays={30}
      highlightedSectionId={null}
      onHighlightedSectionIdChange={jest.fn()}
      onSectionCreationModeChange={jest.fn()}
      removeSection={jest.fn()}
      scanMatches={matches}
      hasScanned
      onScan={jest.fn()}
      onRematch={jest.fn()}
    />
  );
}

describe('scan match names', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the name the engine resolved for the section', () => {
    jest
      .spyOn(sectionDisplayNames, 'getAllSectionDisplayNames')
      .mockReturnValue({ s1: 'Section 1' });

    const screen = renderScan([scanMatch('s1', 'Col des Planches')]);

    expect(screen.getByText('Col des Planches')).toBeTruthy();
    expect(screen.queryByText('Section 1')).toBeNull();
  });

  it('falls back to the id when the engine sends no name', () => {
    const screen = renderScan([scanMatch('abcdef0123456789', undefined)]);

    expect(screen.getByText('abcdef01')).toBeTruthy();
  });
});
