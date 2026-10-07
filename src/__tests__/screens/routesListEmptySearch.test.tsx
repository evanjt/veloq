import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

function renderList(props: { searchQuery: string; totalGroupCount: number }) {
  return render(
    <RoutesList
      onRefresh={jest.fn()}
      batchGroups={[]}
      sortOption="activities"
      onSortChange={jest.fn()}
      onSearchChange={jest.fn()}
      shownGroupCount={0}
      {...props}
    />
  );
}

describe('RoutesList with an empty page', () => {
  it('keeps the search box and says nothing matched when a search finds no routes', () => {
    renderList({ searchQuery: 'zzz', totalGroupCount: 42 });
    expect(screen.getByPlaceholderText('routes.searchRoutes')).toBeTruthy();
    expect(screen.getByText('routes.noMatchingRoutes')).toBeTruthy();
    expect(screen.queryByText('routes.noRoutesYet')).toBeNull();
  });

  it('clears the search from the empty result', () => {
    const onSearchChange = jest.fn();
    render(
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
    fireEvent.press(screen.getByLabelText('common.clearSearch'));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('reads No routes yet and shows no search box when the library has none', () => {
    renderList({ searchQuery: '', totalGroupCount: 0 });
    expect(screen.getByText('routes.noRoutesYet')).toBeTruthy();
    expect(screen.queryByPlaceholderText('routes.searchRoutes')).toBeNull();
  });
});
