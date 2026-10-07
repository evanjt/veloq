import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { initializeI18n, i18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the sections list ends with links to the retired sections and to
 * the named corridors.
 *
 * Expected behaviour: each is a named button on the list, and pressing it
 * opens its screen.
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

const section = {
  id: 'auto_a',
  name: 'Alpha',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  encodedPolyline: '',
  distanceMeters: 1000,
  visitCount: 1,
  isUserDefined: true,
  disabled: false,
} as unknown as SectionWithPolyline;

function renderList() {
  return render(
    <SectionsList
      batchSections={[section]}
      totalSectionCount={1}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={1}
      customSectionCount={0}
      retiredSectionCount={0}
    />
  );
}

describe('SectionsList footer links', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(() => {
    (router.push as jest.Mock).mockClear();
  });

  it('opens the retired sections from a named button', () => {
    const tree = renderList();

    const link = tree.getByRole('button', { name: i18n.t('sectionHistory.seeRetired') });
    fireEvent.press(link);

    expect(link).toBe(tree.getByTestId('sections-retired-link'));
    expect(router.push).toHaveBeenCalledWith('/section-retired');
  });

  it('opens the named corridors from a named button', () => {
    const tree = renderList();

    const link = tree.getByRole('button', { name: i18n.t('namedCorridors.link') });
    fireEvent.press(link);

    expect(link).toBe(tree.getByTestId('sections-named-corridors-link'));
    expect(router.push).toHaveBeenCalledWith('/named-corridors');
  });
});
