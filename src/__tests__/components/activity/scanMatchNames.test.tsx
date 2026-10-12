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

function renderScan(matches: SectionMatch[], pointCount = 0) {
  const coordinates = Array.from({ length: pointCount }, (_, i) => ({
    latitude: 46 + i * 1e-4,
    longitude: 7,
  }));
  return render(
    <ActivitySectionsSection
      activityId="a1"
      sportType="Ride"
      encounters={[]}
      coordinates={coordinates}
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

  it('shows the name the engine resolved for the section', async () => {
    jest
      .spyOn(sectionDisplayNames, 'getAllSectionDisplayNames')
      .mockReturnValue({ s1: 'Section 1' });

    const screen = await renderScan([scanMatch('s1', 'Col des Planches')]);

    expect(screen.getByText('Col des Planches')).toBeTruthy();
    expect(screen.queryByText('Section 1')).toBeNull();
  });

  it('falls back to the id when the engine sends no name', async () => {
    const screen = await renderScan([scanMatch('abcdef0123456789', undefined)]);

    expect(screen.getByText('abcdef01')).toBeTruthy();
  });

  it('speaks the name with the distance, position and match quality the row draws', () => {
    const screen = renderScan([scanMatch('s1', 'Col des Planches')]);

    expect(screen.getByRole('button', { name: 'Col des Planches, 1.2 km' })).toBeTruthy();
  });

  it('speaks a reverse match as the reverse word, not the arrow glyph', () => {
    const reverse = {
      ...scanMatch('s1', 'Col des Planches'),
      sameDirection: false,
      startIndex: 50,
      matchQuality: 0.8,
    } as SectionMatch;

    const screen = renderScan([reverse], 100);

    expect(screen.getByText('Col des Planches \u21A9')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Col des Planches, sections.reverse, 1.2 km, sections.atPosition, sections.matchQuality',
      })
    ).toBeTruthy();
  });
});
