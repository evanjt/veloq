import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import {
  DEFAULT_SECTION_HIDE_FLAGS,
  type SectionHideFlags,
} from '@/features/routes/lib/routesScreenQuery';
import type { FfiCatalogueEmptyReason, SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the engine has narrowed the sections catalogue to nothing, by a
 * search, a sport or a hidden kind, while the catalogue itself holds sections.
 *
 * Expected behaviour: the empty list says which filter emptied it and offers
 * one tap that clears them all and brings the rows back. A catalogue with no
 * sections says the engine's reason, with nothing to clear.
 */

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({
    isDark: false,
    colors: { text: '#000000', textSecondary: '#666666', textOnDark: '#ffffff' },
  }),
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
  useSectionCommands: () => ({ removeSection: jest.fn() }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ enableSection: jest.fn() }),
}));

const record = (id: string, name: string, sport: string): SectionWithPolyline =>
  ({
    id,
    name,
    sectionType: 'auto',
    sportTypes: [sport],
    encodedPolyline: '',
    distanceMeters: 1000,
    visitCount: 3,
    isUserDefined: false,
    disabled: false,
  }) as unknown as SectionWithPolyline;

const CATALOGUE = [
  record('auto_quay', 'Quay sprint', 'Ride'),
  record('auto_mill', 'Mill climb', 'Run'),
];

/** The routes screen's part: it holds the query and the engine answers it. */
function Screen({
  initialSearch = '',
  initialSport,
}: {
  initialSearch?: string;
  initialSport?: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [sport, setSport] = useState<string | undefined>(initialSport);
  const [hidden, setHidden] = useState<SectionHideFlags>(DEFAULT_SECTION_HIDE_FLAGS);
  const rows = CATALOGUE.filter(
    (s) =>
      (s.name ?? '').toLowerCase().includes(search.toLowerCase()) &&
      (sport === undefined || s.sportTypes.includes(sport))
  );
  return (
    <SectionsList
      batchSections={rows}
      totalSectionCount={CATALOGUE.length}
      shownSectionCount={rows.length}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery={search}
      onSearchChange={setSearch}
      sportOptions={['Ride', 'Run']}
      sportType={sport}
      onSportChange={setSport}
      hiddenFilters={hidden}
      onHiddenFiltersChange={setHidden}
      onClearFilters={() => {
        setSearch('');
        setSport(undefined);
        setHidden(DEFAULT_SECTION_HIDE_FLAGS);
      }}
      unacceptedAutoCount={0}
      acceptedAutoCount={2}
      customSectionCount={0}
      retiredSectionCount={0}
    />
  );
}

describe('a sections list its filters have emptied', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('names the search and clears it in one tap, bringing the rows back', async () => {
    await render(<Screen initialSearch="weir" />);

    expect(screen.getByText('No sections for “weir”')).toBeTruthy();
    expect(screen.queryByText('Try adjusting the sport type filter')).toBeNull();
    expect(screen.queryByText('No frequent sections yet')).toBeNull();

    await fireEvent.press(screen.getByTestId('sections-clear-filters'));

    expect(screen.getByText('Quay sprint')).toBeTruthy();
    expect(screen.getByText('Mill climb')).toBeTruthy();
  });

  it('names the search and the sport together when both narrow it', async () => {
    await render(<Screen initialSearch="quay" initialSport="Run" />);

    expect(screen.getByText('No sections for “quay” · Run')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sections-clear-filters'));
    expect(screen.getByText('Quay sprint')).toBeTruthy();
  });

  it('says the reason rather than the filters when the catalogue itself is empty', async () => {
    const noneFound = {
      tag: 'NoneFound',
      inner: { minActivities: 3 },
    } as unknown as FfiCatalogueEmptyReason;
    await render(
      <SectionsList
        batchSections={[]}
        totalSectionCount={0}
        sortOption="name"
        onSortChange={jest.fn()}
        searchQuery="weir"
        onSearchChange={jest.fn()}
        emptyReason={noneFound}
        hiddenFilters={DEFAULT_SECTION_HIDE_FLAGS}
        onHiddenFiltersChange={jest.fn()}
        onClearFilters={jest.fn()}
        unacceptedAutoCount={0}
        acceptedAutoCount={0}
        customSectionCount={0}
        retiredSectionCount={0}
      />
    );

    expect(screen.getByText('No frequent sections yet')).toBeTruthy();
    expect(screen.queryByTestId('sections-clear-filters')).toBeNull();
  });
});
