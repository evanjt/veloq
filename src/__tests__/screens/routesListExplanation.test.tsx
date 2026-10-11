/**
 * Scenario: the Routes sub-tab with routes in it, and with none.
 *
 * Expected behaviour: a list of routes closes on the card that says what a
 * route is and where its numbers come from. An empty library shows its own
 * empty state instead.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import type { FfiCatalogueEmptyReason, GroupWithPolyline } from 'veloqrs';

import { RoutesList } from '@/features/routes/components/RoutesList';

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

const group = { groupId: 'loop-a' } as unknown as GroupWithPolyline;
const noneFound = {
  tag: 'NoneFound',
  inner: { minActivities: 2 },
} as unknown as FfiCatalogueEmptyReason;

function renderList(batchGroups: GroupWithPolyline[]) {
  return render(
    <RoutesList
      onRefresh={jest.fn()}
      batchGroups={batchGroups}
      sortOption="activities"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      totalGroupCount={batchGroups.length}
      shownGroupCount={batchGroups.length}
      emptyReason={batchGroups.length === 0 ? noneFound : null}
    />
  );
}

describe('the Routes explanation card', () => {
  it('closes a list of routes', () => {
    renderList([group]);

    const card = screen.getByTestId('routes-explanation');
    expect(within(card).getByText('routes.explanation.routesTitle')).toBeTruthy();
    expect(within(card).getByText('routes.explanation.routesWhatLabel')).toBeTruthy();
    expect(within(card).getByText('insights.explanation.sourcesLabel')).toBeTruthy();
  });

  it('leaves an empty library to its empty state', () => {
    renderList([]);

    expect(screen.queryByTestId('routes-explanation')).toBeNull();
    expect(screen.getByText('routes.noRoutesYet')).toBeTruthy();
  });
});
