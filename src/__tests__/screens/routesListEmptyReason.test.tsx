/**
 * Scenario: the Routes sub-tab over a library with no route in it, for each
 * reason the engine gives: no activity with GPS, a detect not yet run, one
 * running, one held, and one that found no repeat.
 *
 * Expected behaviour: the list says that reason, with the number it rests on,
 * and offers the one action that can change it. A list with no reason and no
 * rows is a search or filter that matched nothing.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { FfiCatalogueEmptyReason } from 'veloqrs';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { RoutesList } from '@/features/routes/components/RoutesList';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: require('@/theme').colors }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));
jest.mock('@/features/routes/components/DataRangeFooter', () => ({
  DataRangeFooter: () => null,
}));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn() }));

const { tapTo } = jest.requireMock('@/shared/app/navigation') as { tapTo: jest.Mock };

function reason(tag: string, inner?: Record<string, unknown>): FfiCatalogueEmptyReason {
  return { tag, inner } as unknown as FfiCatalogueEmptyReason;
}

function held(tag: string, inner?: Record<string, unknown>): FfiCatalogueEmptyReason {
  return reason('Held', { hold: { tag, inner } });
}

function renderList(
  emptyReason: FfiCatalogueEmptyReason | null,
  extra: { searchQuery?: string; totalGroupCount?: number } = {}
) {
  return render(
    <RoutesList
      onRefresh={jest.fn()}
      batchGroups={[]}
      sortOption="activities"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      totalGroupCount={0}
      shownGroupCount={0}
      emptyReason={emptyReason}
      {...extra}
    />
  );
}

describe('RoutesList empty reason', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
    tapTo.mockClear();
  });

  it('says a library of indoor sessions has no GPS, and offers a wider range', () => {
    renderList(reason('NoGpsActivities'));

    expect(screen.getByText('No activities with GPS')).toBeTruthy();
    expect(
      screen.getByText(/only sessions without one, such as trainer, pool or strength/)
    ).toBeTruthy();
    expect(screen.queryByText('No routes yet')).toBeNull();
    fireEvent.press(screen.getByText('Expand range'));
    expect(tapTo).toHaveBeenCalledWith('/sync-settings');
  });

  it('counts the activities a detect has still to see', () => {
    renderList(reason('NotYetRun', { awaiting: 3 }));

    expect(screen.getByText('Waiting for analysis')).toBeTruthy();
    expect(screen.getByText(/^3 activities with GPS are waiting for analysis/)).toBeTruthy();
  });

  it('says one waiting activity singly', () => {
    renderList(reason('NotYetRun', { awaiting: 1 }));

    expect(screen.getByText(/^1 activity with GPS is waiting for analysis/)).toBeTruthy();
  });

  it('names the running phase and how far it has got', () => {
    renderList(reason('Running', { phase: 'analyzing', percent: 42 }));

    expect(screen.getByText('Analysis running')).toBeTruthy();
    expect(screen.getByText(/^Analysing activities: 42% done\./)).toBeTruthy();
  });

  it('opens the settings that resume a paused elevation download holding the detect', () => {
    renderList(held('ElevationPaused'));

    expect(screen.getByText('Analysis on hold')).toBeTruthy();
    expect(
      screen.getByText('Detection is held until you resume the elevation download in Settings')
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Open settings'));
    expect(tapTo).toHaveBeenCalledWith('/detection-settings');
  });

  it('sizes an elevation queue that waits on the network, with no action', () => {
    renderList(held('ElevationWaiting', { remaining: 12 }));

    expect(screen.getByText(/waits on elevation for 12 activity tracks/)).toBeTruthy();
    expect(screen.queryByText('Open settings')).toBeNull();
    expect(screen.queryByText('Expand range')).toBeNull();
  });

  it('names the migration when the cutover holds the detect', () => {
    renderList(held('Cutover'));

    expect(screen.getByText('Detection paused while your sections migrate')).toBeTruthy();
  });

  it('states the repeat threshold when the detect found no route', () => {
    renderList(reason('NoneFound', { minActivities: 2 }));

    expect(screen.getByText('No routes yet')).toBeTruthy();
    expect(
      screen.getByText(/^A route needs at least 2 activities on a similar path\./)
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search routes...')).toBeNull();
  });

  it('keeps the reason ahead of a search when the catalogue holds no route', () => {
    renderList(reason('NoneFound', { minActivities: 2 }), { searchQuery: 'loop' });

    expect(screen.getByText('No routes yet')).toBeTruthy();
    expect(screen.queryByText('No matching routes found')).toBeNull();
  });

  it('reads a search that matched nothing as no match when the engine names no reason', () => {
    renderList(null, { searchQuery: 'loop', totalGroupCount: 4 });

    expect(screen.getByText('No matching routes found')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });
});
