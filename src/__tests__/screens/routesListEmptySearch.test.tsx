import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FfiCatalogueEmptyReason } from 'veloqrs';

import { RoutesList } from '@/features/routes/components/RoutesList';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: require('@/theme').colors }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));
jest.mock('@/features/routes/components/DataRangeFooter', () => ({
  DataRangeFooter: () => null,
}));

const noneFound = {
  tag: 'NoneFound',
  inner: { minActivities: 2 },
} as unknown as FfiCatalogueEmptyReason;

function renderList(props: {
  searchQuery: string;
  totalGroupCount: number;
  emptyReason?: FfiCatalogueEmptyReason;
  sportType?: string;
  onClearFilters?: () => void;
}) {
  return render(
    <RoutesList
      onRefresh={jest.fn()}
      batchGroups={[]}
      sortOption="activities"
      onSortChange={jest.fn()}
      onSearchChange={jest.fn()}
      onSportChange={jest.fn()}
      onClearFilters={jest.fn()}
      shownGroupCount={0}
      {...props}
    />
  );
}

describe('RoutesList with an empty page', () => {
  it('keeps the search box and says nothing matched when a search finds no routes', async () => {
    await renderList({ searchQuery: 'zzz', totalGroupCount: 42 });
    expect(screen.getByPlaceholderText('routes.searchRoutes')).toBeTruthy();
    expect(screen.getByTestId('empty-state-title').props.children).toMatch(
      /^routes\.noRoutesFor:.*common\.quoted.*zzz/
    );
    expect(screen.queryByText('routes.routesWithTwoPlus')).toBeNull();
    expect(screen.queryByText('routes.noRoutesYet')).toBeNull();
  });

  it('names the sport that emptied the list and clears every filter in one tap', async () => {
    const onClearFilters = jest.fn();
    await renderList({ searchQuery: '', sportType: 'Swim', totalGroupCount: 42, onClearFilters });
    expect(screen.getByText(/^routes\.noRoutesFor:.*activityTypes\.Swim/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('routes-clear-filters'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('clears the search from the empty result', async () => {
    const onSearchChange = jest.fn();
    await render(
      <RoutesList
        onRefresh={jest.fn()}
        batchGroups={[]}
        sortOption="activities"
        onSortChange={jest.fn()}
        onSearchChange={onSearchChange}
        searchQuery="zzz"
        totalGroupCount={42}
        shownGroupCount={0}
      />
    );
    await fireEvent.press(screen.getByLabelText('common.clearSearch'));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('reads No routes yet and shows no search box when the library has none', async () => {
    await renderList({ searchQuery: '', totalGroupCount: 0, emptyReason: noneFound });
    expect(screen.getByText('routes.noRoutesYet')).toBeTruthy();
    expect(screen.getByTestId('empty-state-title')).toBeTruthy();
    expect(screen.queryByPlaceholderText('routes.searchRoutes')).toBeNull();
    expect(screen.queryByTestId('routes-clear-filters')).toBeNull();
  });

  it('names the engine refusal and retries in place when the page read failed', async () => {
    const onRetry = jest.fn();
    await render(
      <RoutesList
        onRefresh={jest.fn()}
        batchGroups={[]}
        sortOption="activities"
        onSortChange={jest.fn()}
        onSearchChange={jest.fn()}
        searchQuery=""
        totalGroupCount={0}
        shownGroupCount={0}
        loadError={{ tag: 'Busy', message: 'a job is running' }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText('engine.failure.busy')).toBeTruthy();
    expect(screen.queryByText('emptyState.error.description')).toBeNull();
    await fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
