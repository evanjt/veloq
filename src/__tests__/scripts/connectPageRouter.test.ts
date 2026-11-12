/**
 * Scenario: the connect page keeps its screen in `location.hash`, as a path
 * and a query that match the phone's own paths.
 *
 * Expected behaviour: a hash parses to its screen and query and writes back
 * byte for byte. An unknown path opens the feed. The route is held, not shown,
 * until the link is connected, and a drop keeps it. A key typed in a text
 * field does nothing.
 */

import {
  TABS,
  keyAction,
  parse,
  queryValue,
  resolve,
  restore,
  tabOf,
  write,
} from '../../../web/connect/router';
import { createStore } from '../../../web/connect/store';

const HASHES = [
  '#/feed',
  '#/feed?range=thisYear&sport=ride&id=i42',
  '#/activity/demo-test-0',
  '#/map',
  '#/routes',
  '#/route/r%2F1',
  '#/sections',
  '#/section/s9',
  '#/fitness',
  '#/insights',
  '#/best-efforts',
  '#/settings',
  '#/settings/units',
  '#/feed?q=a%20b%26c',
];

describe('router paths', () => {
  it.each(HASHES)('%s parses and writes back byte for byte', (hash) => {
    expect(write(parse(hash))).toBe(hash);
  });

  it('reads the screen, id and query', () => {
    expect(parse('#/feed?range=thisYear&sport=ride')).toEqual({
      screen: 'feed',
      id: null,
      query: [
        ['range', 'thisYear'],
        ['sport', 'ride'],
      ],
    });
    const route = parse('#/activity/abc');
    expect(route).toMatchObject({ screen: 'activity', id: 'abc' });
    expect(queryValue(parse('#/feed?sport=run'), 'sport')).toBe('run');
    expect(queryValue(route, 'sport')).toBeNull();
  });

  it.each([
    '',
    '#',
    '#/',
    '#/nowhere',
    '#/activity',
    '#/map/extra',
    '#/feed/x/y',
    '#/route/%E0%A4%A',
    '#nope',
    '#/feed?=x',
  ])('opens the feed for %j', (hash) => {
    expect(write(parse(hash))).toBe('#/feed');
  });

  it('files each screen under the phone tab that holds it', () => {
    expect(TABS).toEqual(['feed', 'fitness', 'insights', 'map', 'settings']);
    expect(tabOf(parse('#/activity/a'))).toBe('feed');
    expect(tabOf(parse('#/section/s'))).toBe('map');
    expect(tabOf(parse('#/best-efforts'))).toBe('insights');
    expect(tabOf(parse('#/settings/units'))).toBe('settings');
  });
});

describe('router and the link', () => {
  it('holds the route and shows nothing while the link is waiting', () => {
    const held = parse('#/fitness');
    const result = resolve('waiting', '#/map', held);
    expect(result.shown).toBeNull();
    expect(result.held).toBe(held);
  });

  it('applies the hash once connected', () => {
    const result = resolve('connected', '#/section/s9', null);
    expect(write(result.shown!)).toBe('#/section/s9');
    expect(result.held).toBe(result.shown);
  });

  it('keeps the hash through a drop and a reconnect', () => {
    let held = resolve('connected', '#/insights', null).held;
    held = resolve('waiting', '#/insights', held).held;
    held = resolve('connecting', '#/insights', held).held;
    expect(restore(held, '#/insights')).toBe('#/insights');
    expect(resolve('connected', '#/insights', held).shown).toEqual(parse('#/insights'));
  });

  it('restores from the address bar on a fresh load', () => {
    expect(restore(null, '#/map')).toBe('#/map');
    expect(restore(null, '')).toBe('#/feed');
  });
});

describe('router keys', () => {
  const press = (key: string, tagName = 'BODY') => keyAction({ key, target: { tagName } });

  it('switches tabs with 1 to 5 in the phone order', () => {
    expect(press('1')).toEqual({ do: 'tab', tab: 'feed' });
    expect(press('4')).toEqual({ do: 'tab', tab: 'map' });
    expect(press('5')).toEqual({ do: 'tab', tab: 'settings' });
    expect(press('6')).toBeNull();
  });

  it('maps search, close and help', () => {
    expect(press('/')).toEqual({ do: 'search' });
    expect(press('Escape')).toEqual({ do: 'closeDetail' });
    expect(press('?')).toEqual({ do: 'help' });
  });

  it('maps j, k and the arrow keys to a step and Enter to open', () => {
    expect(press('j')).toEqual({ do: 'step', step: 'next' });
    expect(press('ArrowDown')).toEqual({ do: 'step', step: 'next' });
    expect(press('k')).toEqual({ do: 'step', step: 'previous' });
    expect(press('ArrowUp')).toEqual({ do: 'step', step: 'previous' });
    expect(press('Enter')).toEqual({ do: 'open' });
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('does nothing in a %s', (tag) => {
    for (const key of ['1', '/', 'Escape', '?', 'j', 'ArrowDown', 'Enter'])
      expect(press(key, tag)).toBeNull();
  });

  it('does nothing in an editable region or with a modifier held', () => {
    expect(keyAction({ key: '1', target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
    expect(keyAction({ key: '1', ctrlKey: true, target: { tagName: 'BODY' } })).toBeNull();
  });
});

describe('screen store', () => {
  it('forgets every screen on a drop and refuses data from the old connection', () => {
    const store = createStore();
    store.clear(1);
    expect(store.put('feed', 1, [{ id: 'i1' }])).toBe(true);
    expect(store.get('feed', 1)).toEqual([{ id: 'i1' }]);
    store.clear(2);
    expect(store.get('feed', 2)).toBeUndefined();
    expect(store.put('feed', 1, [{ id: 'late' }])).toBe(false);
    expect(store.get('feed', 1)).toBeUndefined();
  });
});
