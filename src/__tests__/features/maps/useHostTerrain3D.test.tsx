/**
 * Scenario: a detail host holds one 3D mode for every card. The map of the card on top reads it
 * when it mounts, so a pushed or popped card keeps the mode, and a view outside a host keeps its
 * own.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useSharedTerrain3D } from '@/features/maps/hooks/useHostTerrain3D';
import { MapSheetHostContext, type MapSheetHostValue } from '@/shared/app/MapSheetHost';
import {
  hostTerrain3D,
  openHost,
  popHostCard,
  pushHostCard,
  useMapSheetHosts,
} from '@/shared/app/mapSheetHost';

beforeEach(() => useMapSheetHosts.setState({ hosts: {} }));

function inHost(key: string) {
  const value = { key } as unknown as MapSheetHostValue;
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <MapSheetHostContext.Provider value={value}>{children}</MapSheetHostContext.Provider>
  );
  return Wrapper;
}

describe('useSharedTerrain3D', () => {
  it('opens the next card in the mode the last one was left in', () => {
    const key = openHost('activity', 'a1');
    const first = renderHook(() => useSharedTerrain3D(false), { wrapper: inHost(key) });
    act(() => first.result.current.setIs3D(true));
    first.unmount();

    act(() => pushHostCard(key, { kind: 'section', id: 's1' }));
    const second = renderHook(() => useSharedTerrain3D(false), { wrapper: inHost(key) });

    expect(second.result.current.is3D).toBe(true);
    expect(second.result.current.inherited).toBe(true);
  });

  it('keeps the mode through a pop, and a mode turned off on the pushed card with it', () => {
    const key = openHost('activity', 'a1');
    const first = renderHook(() => useSharedTerrain3D(false), { wrapper: inHost(key) });
    act(() => first.result.current.setIs3D(true));
    first.unmount();
    act(() => pushHostCard(key, { kind: 'section', id: 's1' }));
    const second = renderHook(() => useSharedTerrain3D(false), { wrapper: inHost(key) });
    act(() => second.result.current.setIs3D((on) => !on));
    second.unmount();
    act(() => popHostCard(key));

    const back = renderHook(() => useSharedTerrain3D(true), { wrapper: inHost(key) });

    expect(back.result.current.is3D).toBe(false);
  });

  it('publishes the opening mode of the first map in a host', () => {
    const key = openHost('activity', 'a1');

    renderHook(() => useSharedTerrain3D(true), { wrapper: inHost(key) });

    expect(hostTerrain3D(key)).toBe(true);
  });

  it('is the view own state outside a host', () => {
    const view = renderHook(() => useSharedTerrain3D(false));

    act(() => view.result.current.setIs3D(true));

    expect(view.result.current.is3D).toBe(true);
    expect(view.result.current.inherited).toBe(false);
  });
});
