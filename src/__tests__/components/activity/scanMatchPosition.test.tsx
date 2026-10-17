/**
 * Scenario: a scan offers a section the ride passes partway along.
 *
 * Expected behaviour: the row places the pass by the distance ridden to its
 * start, in the athlete's unit, and never as a share of the track's points,
 * which recording density skews.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { SectionMatch } from 'veloqrs';

import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';
import { initialiseI18n } from '@/i18n';

jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: () => null,
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

function scanMatch(startDistanceMeters: number): SectionMatch {
  return {
    sectionId: 's1',
    sectionName: 'Gorge road',
    startIndex: 10,
    endIndex: 40,
    matchQuality: 0.95,
    sameDirection: true,
    distanceMeters: 1200,
    startDistanceMeters,
  } as SectionMatch;
}

// The start index is a tenth of the points, and the row reads the distance
// ridden to it instead.
function renderScan(match: SectionMatch, isMetric: boolean) {
  const coordinates = Array.from({ length: 100 }, (_, i) => ({
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
      isMetric={isMetric}
      sectionCreationMode={false}
      cacheDays={30}
      highlightedSectionId={null}
      onHighlightedSectionIdChange={jest.fn()}
      onSectionCreationModeChange={jest.fn()}
      removeSection={jest.fn()}
      scanMatches={[match]}
      hasScanned
      onScan={jest.fn()}
      onRematch={jest.fn()}
    />
  );
}

describe('scan match position', () => {
  it('reads the distance ridden to the pass in kilometres', () => {
    const screen = renderScan(scanMatch(12_400), true);

    expect(screen.getByText('1.2 km · from 12.4 km')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Gorge road, 1.2 km, from 12.4 km' })).toBeTruthy();
  });

  it('reads the same position in miles under imperial units', () => {
    const screen = renderScan(scanMatch(12_400), false);

    expect(screen.getByText('0.7 mi · from 7.7 mi')).toBeTruthy();
  });

  it('places a pass that starts at the first point at the start of the ride', () => {
    const screen = renderScan({ ...scanMatch(0), startIndex: 0 }, true);

    expect(screen.getByText('1.2 km · from 0 m')).toBeTruthy();
  });
});
