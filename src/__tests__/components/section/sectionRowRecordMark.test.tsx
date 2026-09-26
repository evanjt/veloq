import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { convertSectionWithPolylineToApp } from '@/features/routes/lib/sectionConversions';
import { unifySections } from '@/features/routes/lib/unifySections';
import type { FrequentSection } from '@/types';

// The binding registers a TurboModule at import time, so the stub is the module.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

/**
 * Scenario: the feed card marks the activity that set a section record and the
 * activity plot marks the encounter. The sections list row marked nothing, so
 * an athlete who saw the trophy on the feed and opened the Routes tab to find
 * the section could not tell which row it was.
 * Expected behaviour: a section whose latest outing is its record carries a
 * mark on the row, one that has not does not, and the mark says so in words for
 * a screen reader rather than only in a trophy.
 */

const BASE: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportType: 'Ride',
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('the sections list row marks a section whose latest outing is its record', () => {
  it('draws the mark when the engine flags it', () => {
    render(<SectionRow section={{ ...BASE, latestIsRecord: true }} />);

    expect(screen.getByTestId('section-row-record-s1')).toBeTruthy();
  });

  it('draws nothing when it does not', () => {
    render(<SectionRow section={{ ...BASE, latestIsRecord: false }} />);

    expect(screen.queryByTestId('section-row-record-s1')).toBeNull();
  });

  it('draws nothing when the engine said nothing, which is every older read', () => {
    render(<SectionRow section={BASE} />);

    expect(screen.queryByTestId('section-row-record-s1')).toBeNull();
  });

  it('names the mark for a screen reader, since a trophy alone says nothing', () => {
    render(<SectionRow section={{ ...BASE, latestIsRecord: true }} />);

    expect(screen.getByTestId('section-row-record-s1').props.accessibilityLabel).toBe(
      'sections.latestIsRecord'
    );
  });
});

describe('the flag survives the path from the engine record to the row', () => {
  // Every step between the read and the row spreads rather than rebuilds, so
  // the flag rides along. A step that starts constructing a fresh object drops
  // it silently, and the row would simply stop marking anything.
  const record = {
    id: 's1',
    name: 'Col',
    sportType: 'Ride',
    visitCount: 3,
    distanceMeters: 1200,
    activityCount: 3,
    confidence: 0.9,
    scale: null,
    bounds: null,
    encodedPolyline: new Uint8Array([]),
    sportTypes: ['Ride'],
    isUserDefined: false,
    disabled: false,
    supersededBy: null,
    elevationGainM: null,
    elevationLossM: null,
    avgGradePercent: null,
    maxGradePercent: null,
    klass: null,
    isLift: false,
    rankScore: null,
    sportRankScore: null,
    latestIsRecord: true,
  } as unknown as Parameters<typeof convertSectionWithPolylineToApp>[0];

  it('survives the conversion out of the engine record', () => {
    expect(convertSectionWithPolylineToApp(record).latestIsRecord).toBe(true);
  });

  it('survives the merge with the custom store', () => {
    const merged = unifySections({
      engineSections: [convertSectionWithPolylineToApp(record)],
      customSections: [],
      includeCustom: true,
    });

    expect(merged[0].latestIsRecord).toBe(true);
  });
});
