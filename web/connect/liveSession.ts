// The live strength session as the browser follows it. The engine holds the
// session and decides every change; this builds the asks the link accepts and
// reads the countdown off the focus state the phone answered.

import type { Methods } from './schema';

export type LiveAnswer = Methods['strength.live']['result'];
export type LiveEdit = Methods['strength.liveEdit']['params']['edit'];
type Kind = LiveEdit['kind'];

/** An edit of one kind with only the fields that kind reads. */
export function liveEdit(kind: Kind, fields: Partial<Omit<LiveEdit, 'kind'>> = {}): LiveEdit {
  return {
    kind,
    exercise: null,
    set: null,
    to: null,
    groupNo: null,
    category: null,
    name: null,
    value: null,
    text: null,
    flag: null,
    ...fields,
  };
}

/** The write that ticks a set. */
export const completeSet = (exercise: number, set: number): LiveEdit =>
  liveEdit('completeSet', { exercise, set });

/** The write that takes a tick back. */
export const reopenSet = (exercise: number, set: number): LiveEdit =>
  liveEdit('reopenSet', { exercise, set });

/** The write for a value typed into reps or weight, in the athlete's unit. */
export function typedSet(
  exercise: number,
  set: number,
  field: 'reps' | 'weight',
  value: number | null
): LiveEdit {
  return liveEdit(field === 'reps' ? 'setReps' : 'setWeightEntered', { exercise, set, value });
}

/** Whole seconds left of the running rest, never below zero; null when none runs. */
export function restRemaining(focus: LiveAnswer['focus'], nowSeconds: number): number | null {
  if (!focus || focus.phase !== 'rest' || focus.restEndsAt === null) return null;
  return Math.max(0, Math.ceil(focus.restEndsAt - nowSeconds));
}

/** Seconds as minutes and seconds, `1:05`. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What a typed field holds: empty clears, a number is kept, anything else is refused (undefined). */
export function typedValue(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
