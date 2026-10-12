/**
 * Scenario: the Sections sub-tab over a library with no section of any kind,
 * once for a library with no activity with GPS and once for a detect that
 * found no shared stretch of road.
 *
 * Expected behaviour: the list says which, and states the detector's own
 * threshold. With sections in the catalogue and none on the page, it says the
 * search or filters matched nothing instead.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { FfiCatalogueEmptyReason } from 'veloqrs';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';

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
  getEngine: () => ({}),
}));

function renderList(emptyReason: FfiCatalogueEmptyReason | null, totalSectionCount = 0) {
  return render(
    <SectionsList
      batchSections={[]}
      totalSectionCount={totalSectionCount}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={0}
      customSectionCount={0}
      retiredSectionCount={totalSectionCount}
      emptyReason={emptyReason}
    />
  );
}

describe('SectionsList empty reason', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
  });

  it('says a library of indoor sessions has no GPS', async () => {
    await renderList({ tag: 'NoGpsActivities' } as unknown as FfiCatalogueEmptyReason);

    expect(screen.getByText('No activities with GPS')).toBeTruthy();
    expect(screen.queryByText('No frequent sections yet')).toBeNull();
  });

  it("states the detector's threshold when it found no section", async () => {
    await renderList({
      tag: 'NoneFound',
      inner: { minActivities: 3 },
    } as unknown as FfiCatalogueEmptyReason);

    expect(screen.getByText('No frequent sections yet')).toBeTruthy();
    expect(
      screen.getByText(/^A section needs at least 3 activities over the same stretch of road/)
    ).toBeTruthy();
  });

  it('reads a catalogue the filters hide as no match when the engine names no reason', async () => {
    await renderList(null, 4);

    expect(screen.queryByText('No frequent sections yet')).toBeNull();
    expect(screen.getByTestId('empty-state-title').props.children).toBe('No sections match filter');
  });
});
