import React from 'react';
import { FlatList, Platform } from 'react-native';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the sections list renders on Android, or with nothing to list.
 *
 * Expected behaviour: rows scrolled out of view are detached on iOS only. On
 * Android the clipped list can rest off its top after scrolling back up, with
 * the first row cut off under the header. An empty library and a filter that hides
 * every section each draw the shared EmptyState.
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

const mockEnableSection = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ enableSection: mockEnableSection }),
}));

const record = (
  id: string,
  name: string,
  visitCount: number,
  sectionType: 'auto' | 'custom' = 'auto'
): SectionWithPolyline =>
  ({
    id,
    name,
    sectionType,
    sportTypes: ['Ride'],
    encodedPolyline: '',
    distanceMeters: 1000,
    visitCount,
    isUserDefined: true,
    disabled: false,
  }) as unknown as SectionWithPolyline;

describe('SectionsList row clipping', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it.each([
    ['android', false],
    ['ios', true],
  ] as const)('clips offscreen rows on %s: %s', async (os, clips) => {
    const original = Platform.OS;
    Platform.OS = os;
    try {
      const tree = await render(
        <SectionsList
          batchSections={[record('auto_a', 'Alpha', 1)]}
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
          removedSectionCount={0}
        />
      );
      expect(tree.UNSAFE_getByType(FlatList).props.removeClippedSubviews).toBe(clips);
    } finally {
      Platform.OS = original;
    }
  });
});

describe('SectionsList with nothing to list', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  function renderEmpty(totalSectionCount: number) {
    return render(
      <SectionsList
        batchSections={[]}
        totalSectionCount={totalSectionCount}
        sortOption="name"
        onSortChange={jest.fn()}
        searchQuery=""
        onSearchChange={jest.fn()}
        hiddenFilters={{ custom: true, auto: true, disabled: true, unaccepted: true }}
        onHiddenFiltersChange={jest.fn()}
        unacceptedAutoCount={0}
        acceptedAutoCount={totalSectionCount}
        customSectionCount={0}
        removedSectionCount={0}
      />
    );
  }

  it('draws the shared empty state for a library with no sections', () => {
    expect(renderEmpty(0).getByTestId('empty-state-title')).toBeTruthy();
  });

  it('draws the shared empty state when the filter hides every section', () => {
    expect(renderEmpty(3).getByTestId('empty-state-title')).toBeTruthy();
  });
});
