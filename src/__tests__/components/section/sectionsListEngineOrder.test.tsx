import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

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
  useCustomSections: () => ({
    sections: [],
    count: 0,
    isLoading: false,
    error: null,
    removeSection: jest.fn(),
  }),
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
      customSectionCount={18}
      retiredSectionCount={7}
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
      .getAllByTestId(/^section-row-auto_[a-z0-9]+(-body)?$/)
      .filter((node) => !String(node.props.testID).endsWith('-body'))
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

  it('names the selected row before deleting a custom section', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = renderList({
      batchSections: [
        record('custom_a', 'Zulu', 1, 'custom'),
        record('custom_b', 'Alpha', 1, 'custom'),
      ],
    });
    const rows = tree.UNSAFE_getAllByType(Swipeable);
    const actions = rows[1].props.renderRightActions(null, {
      interpolate: () => 1,
    });
    const swipe = render(actions);

    fireEvent.press(swipe.getByText('Delete'));

    expect(alert.mock.calls[0][1]).toContain('Alpha');
    expect(alert.mock.calls[0][1]).not.toContain('Zulu');
    expect(alert.mock.calls[0][2]?.map((button) => button.style)).toContain('cancel');
  });

  it('offers Restore for a retired row and enables that section', () => {
    const retired = { ...record('auto_retired', 'Retired climb', 2), disabled: true };
    const tree = renderList({ batchSections: [retired] });
    const row = tree.UNSAFE_getByType(Swipeable);
    const swipe = render(row.props.renderRightActions(null, { interpolate: () => 1 }));

    expect(tree.getByTestId('section-row-auto_retired')).toBeTruthy();
    fireEvent.press(swipe.getByText('Restore'));
    expect(mockEnableSection).toHaveBeenCalledWith('auto_retired');
  });
});

/**
 * Expected behaviour: the two figures on the filter bar are the catalogue's,
 * passed down from the engine, and the page cannot move them. The page here
 * holds three auto sections, no custom and no retired, which is what a tally
 * over it would report.
 */
describe('the filter chips count the catalogue, not the page', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('shows the custom and retired figures it was given', () => {
    const { getByText } = renderList();

    expect(getByText('18 Custom')).toBeTruthy();
    expect(getByText('7 Removed')).toBeTruthy();
  });

  it('keeps them when the page holds none of either', () => {
    const { getByText, queryByText } = renderList({
      customSectionCount: 4,
      retiredSectionCount: 2,
    });

    expect(getByText('4 Custom')).toBeTruthy();
    expect(getByText('2 Removed')).toBeTruthy();
    expect(queryByText('0 Removed')).toBeNull();
  });
});

describe('SectionsList over a failed page read', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('shows the failure with a retry, not the empty library copy', () => {
    const onRetry = jest.fn();
    const tree = renderList({
      batchSections: undefined,
      totalSectionCount: 0,
      loadError: new Error('database is locked'),
      onRetry,
    });

    expect(tree.queryByText(/No frequent sections/)).toBeNull();
    fireEvent.press(tree.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
