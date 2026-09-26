/**
 * Scenario: a first sync owes tracks for hundreds of activities and the
 * download runs fifty at a time, in the order it is handed.
 * Expected behaviour: the cards the feed is showing are handed over first, so
 * the previews the athlete is looking at paint before the ones below the fold.
 */

import { headFirst } from '@/features/routes/lib/gpsFetchOrder';

const activity = (id: string) => ({ id });

test('the head ids lead, in the order the feed gave them', () => {
  const ordered = headFirst(
    [activity('a1'), activity('a2'), activity('a3'), activity('a4')],
    ['a3', 'a1']
  );

  expect(ordered.map((a) => a.id)).toEqual(['a3', 'a1', 'a2', 'a4']);
});

test('the rest keep the order they arrived in', () => {
  const ordered = headFirst([activity('a1'), activity('a2'), activity('a3')], ['a3']);

  expect(ordered.map((a) => a.id)).toEqual(['a3', 'a1', 'a2']);
});

test('a head id the fetch does not owe is skipped rather than invented', () => {
  const ordered = headFirst([activity('a1'), activity('a2')], ['gone', 'a2']);

  expect(ordered.map((a) => a.id)).toEqual(['a2', 'a1']);
});

test('no head is the list untouched, and the same array is not required', () => {
  const list = [activity('a1'), activity('a2')];

  expect(headFirst(list, []).map((a) => a.id)).toEqual(['a1', 'a2']);
});

test('a duplicated head id is carried once', () => {
  const ordered = headFirst([activity('a1'), activity('a2')], ['a2', 'a2']);

  expect(ordered.map((a) => a.id)).toEqual(['a2', 'a1']);
});
