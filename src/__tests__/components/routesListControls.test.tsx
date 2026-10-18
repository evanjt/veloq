/**
 * Scenario: the routes and sections lists carry a sort with four or five
 * orders, a row of on/off filters, and the detection preview a row of ranked
 * areas. Each drew its own chip with its own radius, tint and press.
 *
 * Expected behaviour: a sort is the shared menu control reading its current
 * order, an on/off filter and an area are the shared selector chip, and the
 * chosen chip carries the selected state and the selected fill.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { GroupWithPolyline, PreviewCentre } from 'veloqrs';

import { RoutesList } from '@/features/routes/components/RoutesList';
import { SectionsListFiltersBar } from '@/features/routes/components/SectionsListFiltersBar';
import { PreviewCentrePicker } from '@/features/routes/components/preview/PreviewCentrePicker';
import { fallbackLetter } from '@/features/routes/lib/labelPreviewCentres';
import { SelectButton, ToggleButton, selectLabel } from '@/shared/ui';
import { colors } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: require('@/theme').colors }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));
jest.mock('@/features/routes/components/DataRangeFooter', () => ({
  DataRangeFooter: () => null,
}));
jest.mock('@/features/routes/components/RouteRow', () => ({ RouteRow: () => null }));
jest.mock('@/features/routes/lib/batchGroupToRouteGroup', () => ({
  batchGroupToRouteGroup: (group: { groupId: string }) => ({ id: group.groupId }),
}));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { ...jest.requireActual('expo-linear-gradient'), LinearGradient: View };
});

const fill = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) as { backgroundColor?: string }).backgroundColor;

/** The press target a `ToggleButton` renders, found by its role and label. */
const chip = (label: string) => screen.getByRole('button', { name: label });

function renderFilters(onSortChange = jest.fn(), onFilterPress = jest.fn()) {
  return render(
    <PaperProvider>
      <SectionsListFiltersBar
        regularSectionsCount={2}
        sortOption="visits"
        onSortChange={onSortChange}
        sortChips={[
          { key: 'nearby', label: 'Nearby' },
          { key: 'visits', label: 'Most visited' },
          { key: 'distance', label: 'Distance' },
          { key: 'name', label: 'Name' },
        ]}
        customCount={2}
        hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
        onFilterPress={onFilterPress}
        trueDisabledCount={1}
        unacceptedAutoCount={1}
        acceptedAutoCount={1}
      />
    </PaperProvider>
  );
}

describe('the sections filter bar', () => {
  it('reads the sort as one menu control naming the current order', async () => {
    const tree = await renderFilters();

    const sorts = tree.UNSAFE_getAllByType(SelectButton);
    expect(sorts).toHaveLength(1);
    expect(sorts[0]!.props.value).toBe('visits');
    expect(screen.getByLabelText(selectLabel('routes.sortBy', 'Most visited'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nearby' })).toBeNull();
  });

  it('draws each on/off filter as the shared selector chip with its state', async () => {
    const tree = await renderFilters();

    expect(tree.UNSAFE_getAllByType(ToggleButton)).toHaveLength(3);
    const custom = chip('routes.customCount');
    expect(custom.props.accessibilityState).toMatchObject({ selected: true });
    expect(fill(custom)).toBe(colors.controlOn);
    const removed = chip('sections.removedCount');
    expect(removed.props.accessibilityState).toMatchObject({ selected: false });
    expect(fill(removed)).not.toBe(colors.controlOn);
  });

  it('reports which filter was pressed', async () => {
    const onFilterPress = jest.fn();
    await renderFilters(jest.fn(), onFilterPress);

    await fireEvent.press(chip('sections.acceptedOnly'));
    expect(onFilterPress).toHaveBeenCalledWith('unaccepted');
  });
});

describe('the routes list sort', () => {
  it('is one menu control naming the current order', async () => {
    const groups = [{ groupId: 'loop-a' }, { groupId: 'loop-b' }] as unknown as GroupWithPolyline[];
    const tree = await render(
      <PaperProvider>
        <RoutesList
          onRefresh={jest.fn()}
          batchGroups={groups}
          sortOption="distance"
          onSortChange={jest.fn()}
          searchQuery=""
          onSearchChange={jest.fn()}
          totalGroupCount={2}
          shownGroupCount={2}
        />
      </PaperProvider>
    );

    const sorts = tree.UNSAFE_getAllByType(SelectButton);
    expect(sorts).toHaveLength(1);
    expect(sorts[0]!.props.options.map((o: { value: string }) => o.value)).toEqual([
      'nearby',
      'activities',
      'distance',
      'name',
    ]);
    expect(screen.getByLabelText(selectLabel('routes.sortBy', 'routes.sortDistance'))).toBeTruthy();
  });
});

describe('the preview centre picker', () => {
  const centres: PreviewCentre[] = [
    { binKey: 'b0', lat: 1, lng: 2, visitTotal: 14, sectionCount: 3, source: 'sections' },
    { binKey: 'b1', lat: 3, lng: 4, visitTotal: 9, sectionCount: 2, source: 'sections' },
  ];
  const labels = centres.map((c, i) => ({ binKey: c.binKey, fallbackLetter: fallbackLetter(i) }));

  it('draws each area as the shared selector chip, the chosen one filled', async () => {
    const onSelect = jest.fn();
    const tree = await render(
      <PreviewCentrePicker
        centres={centres}
        labels={labels}
        selectedBinKey="b1"
        onSelect={onSelect}
      />
    );

    const areas = tree.UNSAFE_getAllByType(ToggleButton);
    expect(areas.map((a) => a.props.selected)).toEqual([false, true]);
    expect(areas.map((a) => a.props.count)).toEqual([3, 2]);
    const chosen = screen.getByTestId('preview-centre-b1');
    expect(chosen.props.accessibilityState).toMatchObject({ selected: true });
    expect(fill(chosen)).toBe(colors.controlOn);

    await fireEvent.press(screen.getByTestId('preview-centre-b0'));
    expect(onSelect).toHaveBeenCalledWith(centres[0]);
  });
});
