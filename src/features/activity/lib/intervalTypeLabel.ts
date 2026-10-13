/**
 * What the interval table's type column says.
 *
 * An athlete who plans a workout names its intervals, and those words separate
 * a warm up from the effort after it when both sit at the same zone. The zone
 * token is what there is to say when nobody has named it. Colour is the zone's
 * either way: a label never carries one.
 *
 * The type's own word comes from the locale, short where a column or a chip
 * holds it and long for a screen reader.
 */

import type { TFunction } from 'i18next';

import { i18n } from '@/i18n';

export interface IntervalTypeLabelInput {
  type: string;
  zone?: number | null | undefined;
  label?: string | null | undefined;
  /** Whether the row draws a zone colour, which is what makes `Z<n>` readable. */
  zoneColoured: boolean;
}

export type IntervalTypeForm = 'short' | 'long';

export type IntervalTypeKind = 'work' | 'recovery' | 'warmup' | 'cooldown' | 'other';

/** The word family an intervals.icu interval type belongs to. */
export function intervalTypeKind(type: string): IntervalTypeKind {
  if (type === 'WORK') return 'work';
  if (type === 'RECOVERY' || type === 'REST') return 'recovery';
  if (type === 'WARMUP') return 'warmup';
  if (type === 'COOLDOWN') return 'cooldown';
  return 'other';
}

const TYPE_KEY = {
  work: { short: 'intervalTypes.work.short', long: 'intervalTypes.work.long' },
  recovery: { short: 'intervalTypes.recovery.short', long: 'intervalTypes.recovery.long' },
  warmup: { short: 'intervalTypes.warmup.short', long: 'intervalTypes.warmup.long' },
  cooldown: { short: 'intervalTypes.cooldown.short', long: 'intervalTypes.cooldown.long' },
  other: { short: 'intervalTypes.other.short', long: 'intervalTypes.other.long' },
} as const satisfies Record<IntervalTypeKind, Record<IntervalTypeForm, string>>;

/**
 * An interval type's word in the athlete's language. A component passes its
 * own `t`, so a memo over the words recomputes when the language changes.
 */
export function intervalTypeName(
  kind: IntervalTypeKind,
  form: IntervalTypeForm,
  t: TFunction = i18n.t.bind(i18n)
): string {
  return t(TYPE_KEY[kind][form]);
}

export function intervalTypeLabel(
  { type, zone, label, zoneColoured }: IntervalTypeLabelInput,
  form: IntervalTypeForm = 'short'
): string {
  const named = label?.trim();
  if (named) return named;

  const kind = intervalTypeKind(type);
  if (kind === 'work' && zoneColoured) return `Z${zone}`;
  return intervalTypeName(kind, form);
}
