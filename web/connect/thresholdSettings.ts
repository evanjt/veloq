// The thresholds table's fields, words and writes. Pure, so a test drives them
// without a browser. The phone answers each figure with its value and where it
// came from; an edit is one `settings.setThreshold` for a sport and a figure,
// and a blank cell hands the figure back to the activity files.

import type { ParseKeys } from 'i18next';

import type { Methods } from './schema';

export type ThresholdsData = Methods['settings.thresholds']['result'];
export type Figure = ThresholdsData['sports'][number]['figures'][number];
export type ThresholdField = Figure['field'];
export type ThresholdSource = NonNullable<Figure['source']>;

export type ThresholdWrite = {
  method: 'settings.setThreshold';
  params: Methods['settings.setThreshold']['params'];
};

/** The figures the phone offers, in its order, with the page's words for each. */
export const THRESHOLD_FIELDS: readonly { field: ThresholdField; label: ParseKeys }[] = [
  { field: 'ftp', label: 'connectPage.settings.thresholds.fields.ftp' },
  { field: 'thresholdHr', label: 'connectPage.settings.thresholds.fields.thresholdHr' },
  { field: 'maxHr', label: 'connectPage.settings.thresholds.fields.maxHr' },
  { field: 'restingHr', label: 'connectPage.settings.thresholds.fields.restingHr' },
  { field: 'weightKg', label: 'connectPage.settings.thresholds.fields.weightKg' },
];

/** The page's words for where a figure came from. */
export const SOURCE_KEYS: Readonly<Record<ThresholdSource, ParseKeys>> = {
  athlete: 'connectPage.settings.thresholds.source.athlete',
  sportSettings: 'connectPage.settings.thresholds.source.sportSettings',
  file: 'connectPage.settings.thresholds.source.file',
};

const INVALID: ParseKeys = 'connectPage.settings.thresholds.invalid';

/**
 * The write for one edited cell, or why none is made: `error` is the key of the
 * page's words for a value the engine refuses, and null when the cell holds
 * what the phone already shows.
 */
export function thresholdWrite(
  figure: Figure,
  sport: string,
  raw: string
): ({ ok: true } & ThresholdWrite) | { ok: false; error: ParseKeys | null } {
  const text = raw.trim();
  const write = (value: number | null) => ({
    ok: true as const,
    method: 'settings.setThreshold' as const,
    params: { sport, field: figure.field, value },
  });
  if (text === '') return figure.source === 'athlete' ? write(null) : { ok: false, error: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: INVALID };
  if (value === figure.value) return { ok: false, error: null };
  return write(value);
}

/**
 * The write that puts a figure back as it stood: the athlete's own earlier
 * figure again, or no figure of theirs when the earlier one came from the
 * activity files or the account.
 */
export function thresholdUndo(sport: string, figure: Figure): ThresholdWrite {
  return {
    method: 'settings.setThreshold',
    params: {
      sport,
      field: figure.field,
      value: figure.source === 'athlete' ? figure.value : null,
    },
  };
}
