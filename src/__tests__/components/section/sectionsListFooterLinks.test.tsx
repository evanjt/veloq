import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { initialiseI18n, i18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the sections list ends with links to the retired sections and to
 * the named corridors. The retired link is offered only once the ledger holds
 * retired sections, and it is still offered when the list itself is empty.
 *
 * Expected behaviour: each is a named button on the list, and pressing it
 * opens its screen. A library that retired nothing sees no retired link. The
 * list closes on the card that says what a section is and where its times
 * come from.
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

function renderList({
  batchSections = [section],
  retiredSectionCount = 2,
}: {
  batchSections?: SectionWithPolyline[];
  retiredSectionCount?: number;
} = {}) {
  return render(
    <SectionsList
      batchSections={batchSections}
      totalSectionCount={batchSections.length}
      retiredSectionCount={retiredSectionCount}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
      onHiddenFiltersChange={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={1}
      customSectionCount={0}
      removedSectionCount={0}
    />
  );
}

describe('SectionsList footer links', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  beforeEach(() => {
    (router.push as jest.Mock).mockClear();
  });

  it('opens the retired sections from a named button', async () => {
    const tree = await renderList();

    const link = tree.getByRole('button', { name: i18n.t('sectionHistory.seeRetired') });
    await fireEvent.press(link);

    expect(link).toBe(tree.getByTestId('sections-retired-link'));
    expect(router.push).toHaveBeenCalledWith('/detection-preview?layer=retired');
  });

  it('opens the named corridors from a named button', async () => {
    const tree = await renderList();

    const link = tree.getByRole('button', { name: i18n.t('namedCorridors.link') });
    await fireEvent.press(link);

    expect(link).toBe(tree.getByTestId('sections-named-corridors-link'));
    expect(router.push).toHaveBeenCalledWith('/named-corridors');
  });

  it('offers no retired link while the library retired nothing', async () => {
    const tree = await renderList({ retiredSectionCount: 0 });

    expect(tree.queryByTestId('sections-retired-link')).toBeNull();
    expect(tree.queryByRole('button', { name: i18n.t('sectionHistory.seeRetired') })).toBeNull();
  });

  it('keeps the retired link on an empty list when sections retired', async () => {
    const tree = await renderList({ batchSections: [], retiredSectionCount: 2 });

    const link = tree.getByRole('button', { name: i18n.t('sectionHistory.seeRetired') });
    await fireEvent.press(link);

    expect(link).toBe(tree.getByTestId('sections-retired-link'));
    expect(router.push).toHaveBeenCalledWith('/detection-preview?layer=retired');
  });

  it('shows no retired link on an empty list when nothing retired', async () => {
    const tree = await renderList({ batchSections: [], retiredSectionCount: 0 });

    expect(tree.queryByTestId('sections-retired-link')).toBeNull();
  });

  it('closes on the card that explains sections', async () => {
    const tree = await renderList();

    const card = tree.getByTestId('sections-explanation');
    expect(card).toHaveTextContent(new RegExp(i18n.t('routes.explanation.sectionsTitle')));
    expect(card).toHaveTextContent(new RegExp(i18n.t('routes.explanation.sectionsWhatLabel')));
  });
});
