import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the engine orders, filters and counts the whole catalogue and
 * returns one page of it, holding sections the page itself cannot see.
 *
 * Expected behaviour: the list renders that page in the order it arrived and
 * reports the engine's review counts. Re-ordering or re-tallying here reads
 * fifty rows and calls them the library.
 */

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
  useAppSettings: () => ({ settings: {} }),
}));

jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false, refusal: null }),
}));

jest.mock('@/features/routes/hooks/useDetectionHold', () => ({
  useDetectionHold: () => null,
}));

jest.mock('@/features/routes/hooks/useElevationBackfill', () => ({
  useElevationBackfill: () => undefined,
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({
    sections: [],
    count: 0,
    isLoading: false,
    error: null,
    removeSection: jest.fn(),
  }),
}));

jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

const record = (id: string, name: string, visitCount: number): SectionWithPolyline =>
  ({
    id,
    name,
    sportType: 'Ride',
    encodedPolyline: '',
    distanceMeters: 1000,
    visitCount,
    isUserDefined: true,
    disabled: false,
  }) as unknown as SectionWithPolyline;

// The engine's own order for this query. Neither the names nor the visit
// counts reproduce it, so a client-side sort of any kind shows up as a
// different order.
const PAGE = [
  record('auto_c', 'Zulu', 1),
  record('auto_a', 'Alpha', 9),
  record('auto_b', 'Mike', 5),
];

function renderList(over: Record<string, unknown> = {}) {
  return render(
    <SectionsList
      batchSections={PAGE}
      totalSectionCount={140}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={63}
      acceptedAutoCount={21}
      {...over}
    />
  );
}

describe('SectionsList over an engine-ordered page', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('renders the page in the order the engine gave it', () => {
    const tree = renderList();

    const ids = tree
      .getAllByTestId(/^section-row-auto_/)
      .map((node) => String(node.props.testID).replace('section-row-', ''))
      .filter((id, i, all) => all.indexOf(id) === i);

    expect(ids).toEqual(['auto_c', 'auto_a', 'auto_b']);
  });

  it('offers Accept all on the engine count, not the page tally', () => {
    // Every section on this page is already accepted, so a tally taken here is
    // zero while 63 of the catalogue still await review.
    const tree = renderList();

    expect(tree.getByText('Accept All')).toBeTruthy();
    expect(tree.getByText('Accepted only')).toBeTruthy();
  });
});
