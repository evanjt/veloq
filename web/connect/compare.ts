// Comparing two to four rows of a table: the selection a shift-click or a
// ctrl-click builds, its place in the hash, and the rows of the compare table.
// Pure, so a test drives it without a browser.

import { clock, km, kmh } from './format';
import type { Card, Detail } from './session';

export const MAX_COMPARED = 4;

export type Selection = { ids: readonly string[]; anchor?: string | null };
export type Mode = 'single' | 'range' | 'toggle';
export type Selected = { ids: string[]; dropped: string[] };

const cap = (ids: string[]): Selected => {
  const dropped = ids.slice(0, Math.max(0, ids.length - MAX_COMPARED));
  return { ids: ids.slice(dropped.length), dropped };
};

/**
 * The selection after a click on `id` among the rows shown in `order`. A plain
 * click selects that row alone. A range runs from the anchor to the row, in the
 * direction of the click. A toggle adds or removes one row, starting from the
 * anchor when nothing is selected yet. Past four the oldest are dropped, and
 * `dropped` names them.
 */
export function select(
  current: Selection,
  order: readonly string[],
  id: string,
  mode: Mode
): Selected {
  if (mode === 'single') return { ids: [id], dropped: [] };
  if (mode === 'range') {
    const from = current.anchor ? order.indexOf(current.anchor) : -1;
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return { ids: [id], dropped: [] };
    const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return cap(to < from ? span.reverse() : span);
  }
  const held = current.ids.length === 0 && current.anchor ? [current.anchor] : [...current.ids];
  if (held.includes(id)) return { ids: held.filter((held) => held !== id), dropped: [] };
  return cap([...held, id]);
}

/** The `ids` query value, or null with fewer than two to compare. */
export function writeIds(ids: readonly string[]): string | null {
  return ids.length < 2 ? null : ids.map(encodeURIComponent).join(',');
}

/** The ids a query value names: no repeats, none empty, at most four. */
export function readIds(value: string | null): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const part of value.split(',')) {
    let id: string;
    try {
      id = decodeURIComponent(part);
    } catch {
      continue;
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_COMPARED);
}

/** The chart and map colour class of the n-th compared activity, from the page's palette. */
export const compareColour = (at: number) => `line-${at % 4}`;

/** What a pass or an attempt adds to a card: its elapsed seconds. */
export type Pass = { elapsed?: number | null };

export type CompareCell = { text: string | null; best: boolean };
export type CompareRow = { label: string; cells: CompareCell[] };

const whole = (unit: string) => (value: number | null | undefined) =>
  value == null ? null : `${Math.round(value)} ${unit}`.trim();

const minutes = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

type Spec = {
  label: string;
  value: (
    card: Card,
    detail: Detail | undefined,
    pass: Pass | undefined
  ) => number | null | undefined;
  text: (value: number | null | undefined) => string | null;
  best: 'max' | 'min' | null;
};

const SPECS: Spec[] = [
  { label: 'Distance', value: (c) => c.distance, text: km, best: 'max' },
  {
    label: 'Moving time',
    value: (c, d) => d?.movingTime ?? c.movingTime,
    text: clock,
    best: 'min',
  },
  { label: 'Average speed', value: (_c, d) => d?.averageSpeed, text: kmh, best: 'max' },
  { label: 'Climbing', value: (c) => c.elevationGain, text: whole('m'), best: 'max' },
  { label: 'Average heart rate', value: (c) => c.avgHr, text: whole('bpm'), best: 'max' },
  { label: 'Average power', value: (c) => c.avgPower, text: whole('W'), best: 'max' },
  { label: 'Training load', value: (c) => c.trainingLoad, text: whole(''), best: 'max' },
];

/**
 * The compare table's rows, one cell per card. The best value in a row is
 * marked, every tie with it, and only when at least two cells have a value. A
 * cell with no value has no text and is never best. Elapsed time and the delta
 * to the best join the rows when any card has a pass.
 */
export function compareRows(
  cards: readonly Card[],
  details: Readonly<Record<string, Detail | undefined>>,
  passes: Readonly<Record<string, Pass | undefined>> = {}
): CompareRow[] {
  const finite = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v);
  const build = (
    label: string,
    values: (number | null | undefined)[],
    text: Spec['text'],
    best: Spec['best']
  ) => {
    const present = values.filter(finite);
    const target =
      best === null || present.length < 2
        ? null
        : best === 'max'
          ? Math.max(...present)
          : Math.min(...present);
    return {
      label,
      cells: values.map((v) => ({
        text: finite(v) ? text(v) : null,
        best: target !== null && finite(v) && v === target,
      })),
    };
  };
  const rows = SPECS.map((spec) =>
    build(
      spec.label,
      cards.map((c) => spec.value(c, details[c.id], passes[c.id])),
      spec.text,
      spec.best
    )
  );
  const elapsed = cards.map((c) => passes[c.id]?.elapsed);
  if (elapsed.some(finite)) {
    const best = Math.min(...elapsed.filter(finite));
    rows.push(build('Elapsed time', elapsed, (v) => (finite(v) ? minutes(v) : null), 'min'));
    rows.push(
      build(
        'Delta to best',
        elapsed.map((v) => (finite(v) ? v - best : null)),
        (v) => (finite(v) ? `${v === 0 ? '' : '+'}${minutes(v)}` : null),
        null
      )
    );
  }
  return rows.filter((row) => row.cells.some((cell) => cell.text !== null));
}
