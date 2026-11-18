/**
 * Scenario: the connect page's one search opens a palette that groups what it
 * finds by kind, remembers what was opened, and lets the athlete turn the
 * single-key shortcuts off.
 *
 * Expected behaviour: a query returns groups of at most five hits in a fixed
 * kind order, each group that holds more than five carries a show-all route
 * into its list with the text as `q=`; every sidebar page has a digit and a
 * chord, and none is shared; with the shortcuts off no printable single key
 * does anything, while Ctrl+K, Escape and the arrows still do.
 */

import { NAV } from '../../../web/connect/pages';
import {
  CHORDS,
  KIND_ORDER,
  PER_GROUP,
  RECENT_LIMIT,
  chordStep,
  digitTarget,
  groupResults,
  parseRecent,
  remember,
  showAllRoute,
  type Kind,
} from '../../../web/connect/palette';
import { keyAction } from '../../../web/connect/router';
import { parseShortcutsSetting } from '../../../web/connect/shortcuts';

const hit = (kind: Kind, label: string) => ({ id: `${kind}:${label}`, kind, label });

describe('grouping what a query finds', () => {
  it('keeps at most five hits per kind, kinds in the fixed order, and flags the groups with more', () => {
    const hits = [
      ...Array.from({ length: 8 }, (_, at) => hit('route', `Loop ${at}`)),
      hit('page', 'Routes'),
      ...Array.from({ length: 5 }, (_, at) => hit('activity', `Loop ride ${at}`)),
      hit('setting', 'Display'),
    ];
    const groups = groupResults(hits, { route: 8 });
    expect(groups.map((group) => group.kind)).toEqual(['page', 'setting', 'activity', 'route']);
    expect(groups.every((group) => group.hits.length <= PER_GROUP)).toBe(true);
    expect(groups.map((group) => [group.kind, group.total, group.showAll])).toEqual([
      ['page', 1, false],
      ['setting', 1, false],
      ['activity', 5, false],
      ['route', 8, true],
    ]);
    expect(groups.find((group) => group.kind === 'route')?.hits).toHaveLength(5);
  });

  it('takes the total a list reports over the hits it was given', () => {
    const hits = Array.from({ length: 5 }, (_, at) => hit('activity', `Ride ${at}`));
    const [group] = groupResults(hits, { activity: 212 });
    expect(group).toMatchObject({ total: 212, showAll: true });
  });

  it('returns no group for no hits', () => {
    expect(groupResults([], {})).toEqual([]);
  });

  it('orders every kind the palette searches', () => {
    expect(KIND_ORDER).toEqual([
      'page',
      'action',
      'setting',
      'activity',
      'route',
      'section',
      'exercise',
      'workout',
      'recording',
    ]);
  });
});

describe('the list a show-all row opens', () => {
  it('sets q on the list of the kind', () => {
    expect(showAllRoute('activity', 'tempo')).toEqual({
      screen: 'activities',
      id: null,
      query: [['q', 'tempo']],
    });
    expect(showAllRoute('route', 'lake loop')).toMatchObject({ screen: 'routes' });
    expect(showAllRoute('section', 'climb')).toMatchObject({ screen: 'sections' });
    expect(showAllRoute('workout', 'legs')).toMatchObject({ screen: 'workouts' });
    expect(showAllRoute('recording', 'x')).toMatchObject({ screen: 'recordings' });
    expect(showAllRoute('exercise', 'squat')).toEqual({
      screen: 'strength',
      id: null,
      query: [['q', 'squat']],
    });
  });

  it('has none for a kind that is not a list', () => {
    expect(showAllRoute('page', 'x')).toBeNull();
    expect(showAllRoute('action', 'x')).toBeNull();
    expect(showAllRoute('setting', 'x')).toBeNull();
  });
});

describe('recent items', () => {
  const entry = (id: string) => ({
    id,
    kind: 'activity' as const,
    label: id,
    route: { screen: 'activity', id, query: [] },
  });

  it('puts the latest first, once, and holds a fixed number', () => {
    let list: ReturnType<typeof remember> = [];
    for (let at = 0; at < RECENT_LIMIT + 3; at += 1) list = remember(list, entry(`a${at}`));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]?.id).toBe(`a${RECENT_LIMIT + 2}`);
    list = remember(list, entry(`a${RECENT_LIMIT}`));
    expect(list.map((item) => item.id).filter((id) => id === `a${RECENT_LIMIT}`)).toHaveLength(1);
    expect(list[0]?.id).toBe(`a${RECENT_LIMIT}`);
  });

  it('reads nothing back from text that is not a list of entries', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([{ id: 1 }, entry('ok')]))).toEqual([entry('ok')]);
  });
});

describe('the digits and chords of the sidebar pages', () => {
  const keys = NAV.flatMap((group) => group.entries).map((page) => page.key);

  it('gives every sidebar page one chord, none shared', () => {
    expect(Object.values(CHORDS).sort()).toEqual([...keys].sort());
    expect(new Set(Object.keys(CHORDS)).size).toBe(keys.length);
  });

  it('gives every sidebar page one digit, in the sidebar order', () => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    expect(keys.map((_, at) => digitTarget(digits[at] as string))).toEqual(keys);
    expect(digitTarget('a')).toBeNull();
  });
});

describe('single-key shortcuts that can be turned off', () => {
  const press = (key: string, shortcuts: boolean) =>
    keyAction({ key, target: { tagName: 'BODY' } }, shortcuts);

  it.each(['j', 'k', '/', '1', '0', '?'])('does nothing on %s when they are off', (key) => {
    expect(press(key, false)).toBeNull();
    expect(press(key, true)).not.toBeNull();
  });

  it('leaves Escape, Enter and the arrows alone when they are off', () => {
    expect(press('Escape', false)).toEqual({ do: 'closeDetail' });
    expect(press('Enter', false)).toEqual({ do: 'open' });
    expect(press('ArrowDown', false)).toEqual({ do: 'step', step: 'next' });
  });

  it('opens the palette on / when they are on', () => {
    expect(press('/', true)).toEqual({ do: 'palette' });
  });

  it('does not arm the g chord when they are off', () => {
    expect(chordStep({ key: 'g' }, false, false)).toEqual({ armed: false, page: null });
    expect(chordStep({ key: 's' }, true, false)).toEqual({ armed: false, page: null });
    expect(chordStep({ key: 'g' }, false, true).armed).toBe(true);
  });

  it('reads the kept setting as on unless it says off', () => {
    expect(parseShortcutsSetting(null)).toBe(true);
    expect(parseShortcutsSetting('on')).toBe(true);
    expect(parseShortcutsSetting('off')).toBe(false);
    expect(parseShortcutsSetting('nonsense')).toBe(true);
  });
});
