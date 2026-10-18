/**
 * Scenario: a map detail screen's map and its sheet share the state of the card on show, through
 * one entry per host screen that the host opens on mount and drops on unmount.
 */

import {
  closeHost,
  closeMapSheetHost,
  mapSheetHostKey,
  openHost,
  openMapSheetHost,
  patchHostTopCard,
  patchTopCard,
  topCard,
  useMapSheetHosts,
} from '@/shared/app/mapSheetHost';

beforeEach(() => useMapSheetHosts.setState({ hosts: {} }));

describe('a map sheet host entry', () => {
  it('is keyed by the kind and the id', () => {
    expect(mapSheetHostKey('route', 'g_harbour')).toBe('route:g_harbour');
    expect(mapSheetHostKey('section', 'g_harbour')).toBe('section:g_harbour');
  });

  it('opens holding one root card of its own subject with no state', () => {
    const hosts = openMapSheetHost({}, 'route', 'g_harbour');

    expect(hosts['route:g_harbour']?.cards).toEqual([
      { kind: 'route', id: 'g_harbour', state: {} },
    ]);
  });

  it('hands what one reader writes to another reading the same key', () => {
    const key = openHost('route', 'g_harbour');

    patchHostTopCard(key, { sport: 'Ride' });

    expect(topCard(useMapSheetHosts.getState().hosts, 'route:g_harbour')?.state).toEqual({
      sport: 'Ride',
    });
  });

  it('keeps one subject apart from another', () => {
    const harbour = openHost('route', 'g_harbour');
    openHost('route', 'g_ridge');

    patchHostTopCard(harbour, { sport: 'Run' });

    expect(topCard(useMapSheetHosts.getState().hosts, 'route:g_ridge')?.state).toEqual({});
  });

  it('is dropped when the host unmounts, so the next open starts with nothing picked', () => {
    const key = openHost('route', 'g_harbour');
    patchHostTopCard(key, { sport: 'Ride' });

    closeHost(key);

    expect(useMapSheetHosts.getState().hosts).toEqual({});
    openHost('route', 'g_harbour');
    expect(topCard(useMapSheetHosts.getState().hosts, key)?.state).toEqual({});
  });

  it('stays while a second screen of the same subject still holds it', () => {
    const opened = openMapSheetHost(
      openMapSheetHost({}, 'route', 'g_harbour'),
      'route',
      'g_harbour'
    );

    const one = closeMapSheetHost(opened, 'route:g_harbour');
    expect(one['route:g_harbour']?.holders).toBe(1);
    expect(closeMapSheetHost(one, 'route:g_harbour')).toEqual({});
  });

  it('closing a host that is not open changes nothing', () => {
    const hosts = openMapSheetHost({}, 'route', 'g_harbour');
    expect(closeMapSheetHost(hosts, 'route:g_ridge')).toBe(hosts);
  });

  it('returns the same hosts for a patch that changes no field, and for a host not open', () => {
    const hosts = patchTopCard(openMapSheetHost({}, 'route', 'g_harbour'), 'route:g_harbour', {
      sport: 'Ride',
    });

    expect(patchTopCard(hosts, 'route:g_harbour', { sport: 'Ride' })).toBe(hosts);
    expect(patchTopCard(hosts, 'route:g_ridge', { sport: 'Run' })).toBe(hosts);
  });
});
