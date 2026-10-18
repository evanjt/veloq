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
  patchCard,
  patchHostCard,
  patchHostTopCard,
  patchTopCard,
  popCard,
  popHostCard,
  pushCard,
  pushHostCard,
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
      { kind: 'route', id: 'g_harbour', params: {}, state: {} },
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

describe('a map sheet host card stack', () => {
  const KEY = 'route:g_harbour';

  it('pushes a card on top of the root with its params and no state', () => {
    const hosts = pushCard(openMapSheetHost({}, 'route', 'g_harbour'), KEY, {
      kind: 'section',
      id: 's_quay',
      params: { activityId: 'a_tide' },
    });

    expect(hosts[KEY]?.cards).toEqual([
      { kind: 'route', id: 'g_harbour', params: {}, state: {} },
      { kind: 'section', id: 's_quay', params: { activityId: 'a_tide' }, state: {} },
    ]);
    expect(topCard(hosts, KEY)?.id).toBe('s_quay');
  });

  it('writes to the card on top, leaving the card below as it was', () => {
    let hosts = patchTopCard(openMapSheetHost({}, 'route', 'g_harbour'), KEY, {
      attemptId: 'a_dawn',
    });
    hosts = pushCard(hosts, KEY, { kind: 'section', id: 's_quay' });

    hosts = patchTopCard(hosts, KEY, { attemptId: 'a_dusk' });

    expect(hosts[KEY]?.cards.map((card) => card.state)).toEqual([
      { attemptId: 'a_dawn' },
      { attemptId: 'a_dusk' },
    ]);
  });

  it('pops back to the card below with its own state as it was', () => {
    let hosts = patchTopCard(openMapSheetHost({}, 'route', 'g_harbour'), KEY, {
      attemptId: 'a_dawn',
      mapCamera: { zoom: 13 },
    });
    hosts = patchTopCard(pushCard(hosts, KEY, { kind: 'section', id: 's_quay' }), KEY, {
      attemptId: 'a_dusk',
    });

    hosts = popCard(hosts, KEY);

    expect(hosts[KEY]?.cards).toHaveLength(1);
    expect(topCard(hosts, KEY)).toEqual({
      kind: 'route',
      id: 'g_harbour',
      params: {},
      state: { attemptId: 'a_dawn', mapCamera: { zoom: 13 } },
    });
  });

  it('never pops the root card, and changes nothing for a host not open', () => {
    const hosts = openMapSheetHost({}, 'route', 'g_harbour');

    expect(popCard(hosts, KEY)).toBe(hosts);
    expect(popCard(hosts, 'route:g_ridge')).toBe(hosts);
    expect(pushCard(hosts, 'route:g_ridge', { kind: 'section', id: 's_quay' })).toBe(hosts);
  });

  it('pops one card at a time from a deeper stack', () => {
    let hosts = openMapSheetHost({}, 'route', 'g_harbour');
    hosts = pushCard(hosts, KEY, { kind: 'section', id: 's_quay' });
    hosts = pushCard(hosts, KEY, { kind: 'route', id: 'g_ridge' });

    hosts = popCard(hosts, KEY);
    expect(hosts[KEY]?.cards.map((card) => card.id)).toEqual(['g_harbour', 's_quay']);
    hosts = popCard(hosts, KEY);
    expect(hosts[KEY]?.cards.map((card) => card.id)).toEqual(['g_harbour']);
    expect(popCard(hosts, KEY)).toBe(hosts);
  });

  it('writes a card below the top by its place, so a card kept under another writes its own', () => {
    let hosts = openMapSheetHost({}, 'route', 'g_harbour');
    hosts = pushCard(hosts, KEY, { kind: 'section', id: 's_quay' });

    hosts = patchCard(hosts, KEY, 0, { deltaLine: 'forward' });

    expect(hosts[KEY]?.cards.map((card) => card.state)).toEqual([{ deltaLine: 'forward' }, {}]);
    expect(patchCard(hosts, KEY, 0, { deltaLine: 'forward' })).toBe(hosts);
    expect(patchCard(hosts, KEY, 2, { deltaLine: 'reverse' })).toBe(hosts);
  });

  it('drives the shared store through its push, pop and patch', () => {
    const key = openHost('route', 'g_harbour');

    pushHostCard(key, { kind: 'section', id: 's_quay' });
    patchHostCard(key, 0, { sport: 'Ride' });
    expect(useMapSheetHosts.getState().hosts[key]?.cards).toHaveLength(2);

    popHostCard(key);
    popHostCard(key);
    expect(topCard(useMapSheetHosts.getState().hosts, key)?.state).toEqual({ sport: 'Ride' });
  });
});
