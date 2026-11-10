/**
 * Scenario: the Sections sub-tab before the engine's page has answered.
 *
 * Expected behaviour: the list shows its skeleton, not the no-match empty
 * state. Once the page has landed empty, or the read failed, the skeleton goes.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
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

function renderList(props: { isLoading: boolean; batchSections?: [] }) {
  return render(
    <SectionsList
      {...(props.batchSections ? { batchSections: props.batchSections } : {})}
      isLoading={props.isLoading}
      totalSectionCount={0}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={0}
      customSectionCount={0}
      removedSectionCount={0}
    />
  );
}

describe('SectionsList loading', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('shows the skeleton while the page has not landed', async () => {
    await renderList({ isLoading: true });

    expect(
      screen.getAllByTestId('row-skeleton', { includeHiddenElements: true }).length
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId('empty-state-title')).toBeNull();
  });

  it('shows the empty state, not the skeleton, once the page landed empty', async () => {
    await renderList({ isLoading: false, batchSections: [] });

    expect(screen.queryByTestId('row-skeleton', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('empty-state-title')).toBeTruthy();
  });
});
