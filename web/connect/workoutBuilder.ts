// The strength workout builder without a screen: the draft the page holds
// while an athlete builds a workout, and the asks it sends the engine. The
// engine owns the catalogue, the ranking, last-time sets and what a saved
// workout is; this only edits the list the athlete is building and says which
// question to ask.

import type { Route } from './router';
import type { Methods } from './schema';

export type DraftSet =
  Methods['strength.saveWorkout']['params']['exercises'][number]['sets'][number];
export type DraftExercise = Methods['strength.saveWorkout']['params']['exercises'][number];
export type DraftGroup = Methods['strength.saveWorkout']['params']['groups'][number];
export type PickerAsk = Methods['strength.picker']['params'];
export type PickerRow = Methods['strength.picker']['result']['rows'][number];

/** The workout being built: `id` is the saved workout it replaces, null for a new one. */
export type Draft = {
  id: string | null;
  name: string;
  exercises: DraftExercise[];
  groups: DraftGroup[];
};

/** What the athlete has typed and pressed in the picker. */
export type PickerState = {
  query: string;
  equipment: string[];
  region: string | null;
  muscle: string | null;
};

/** The set a row starts as: nothing asked of it yet. */
export const BLANK_SET: Readonly<DraftSet> = Object.freeze({
  reps: null,
  weightKg: null,
  durationSecs: null,
  side: null,
  warmUp: false,
});

export const blankDraft = (): Draft => ({ id: null, name: '', exercises: [], groups: [] });

export const openingPicker = (): PickerState => ({
  query: '',
  equipment: [],
  region: null,
  muscle: null,
});

/** The address of a workout opened for editing, or of a new one when there is no id. */
export const routeFor = (id: string | null): Route =>
  id === null ? { screen: 'workouts', id: null, query: [] } : { screen: 'workout', id, query: [] };

/**
 * The ask for the picker's list: the filters and query as typed, and the
 * exercise last in the draft, whose usual followers the engine puts first.
 */
export function pickerAsk(picker: PickerState, draft: Draft, nowWallSeconds: number): PickerAsk {
  const last = draft.exercises[draft.exercises.length - 1];
  return {
    equipment: picker.equipment,
    region: picker.region,
    muscle: picker.muscle,
    query: picker.query,
    afterCategory: last?.category ?? null,
    afterName: last?.name ?? null,
    nowWallSeconds,
  };
}

/** A chip pressed again leaves the list; the region and the muscle it holds are chosen one at a time. */
export function toggledEquipment(picker: PickerState, slug: string): PickerState {
  const equipment = picker.equipment.includes(slug)
    ? picker.equipment.filter((held) => held !== slug)
    : [...picker.equipment, slug];
  return { ...picker, equipment };
}

/** The draft with the exercise at the end, carrying the sets the engine gave it, or one blank set. */
export function withExercise(
  draft: Draft,
  category: number,
  name: number | null,
  sets: DraftSet[]
): Draft {
  const exercise: DraftExercise = {
    category,
    name,
    groupNo: null,
    restSecs: null,
    sets: sets.length > 0 ? sets : [{ ...BLANK_SET }],
  };
  return { ...draft, exercises: [...draft.exercises, exercise] };
}

const replaceAt = <T>(items: T[], index: number, next: T): T[] =>
  items.map((item, at) => (at === index ? next : item));

/** The draft without the exercise at `index`, and without a group it leaves empty. */
export function withoutExercise(draft: Draft, index: number): Draft {
  const exercises = draft.exercises.filter((_, at) => at !== index);
  const used = new Set(exercises.map((exercise) => exercise.groupNo));
  return { ...draft, exercises, groups: draft.groups.filter((group) => used.has(group.groupNo)) };
}

/** The exercise at `index` moved one place up or down; at an end it stays. */
export function movedExercise(draft: Draft, index: number, by: -1 | 1): Draft {
  const target = index + by;
  if (target < 0 || target >= draft.exercises.length) return draft;
  const exercises = [...draft.exercises];
  const moved = exercises[index];
  const other = exercises[target];
  if (moved === undefined || other === undefined) return draft;
  exercises[index] = other;
  exercises[target] = moved;
  return { ...draft, exercises };
}

/** The exercise at `from` taken out and put back at `to`; a place off the list leaves the draft alone. */
export function movedTo(draft: Draft, from: number, to: number): Draft {
  const count = draft.exercises.length;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return draft;
  const exercises = [...draft.exercises];
  const [moved] = exercises.splice(from, 1);
  if (moved === undefined) return draft;
  exercises.splice(to, 0, moved);
  return { ...draft, exercises };
}

/** One value of one set, `null` clearing it. */
export function editedSet<K extends 'reps' | 'weightKg' | 'durationSecs' | 'side' | 'warmUp'>(
  draft: Draft,
  exercise: number,
  set: number,
  key: K,
  value: DraftSet[K]
): Draft {
  const held = draft.exercises[exercise];
  if (!held || !held.sets[set]) return draft;
  const sets = replaceAt(held.sets, set, { ...held.sets[set], [key]: value });
  return { ...draft, exercises: replaceAt(draft.exercises, exercise, { ...held, sets }) };
}

/** A set added after the last, a copy of it so the athlete changes only what differs. */
export function withSet(draft: Draft, exercise: number): Draft {
  const held = draft.exercises[exercise];
  if (!held) return draft;
  const last = held.sets[held.sets.length - 1];
  const next: DraftSet = last ? { ...last } : { ...BLANK_SET };
  return {
    ...draft,
    exercises: replaceAt(draft.exercises, exercise, { ...held, sets: [...held.sets, next] }),
  };
}

/** The exercise without the set at `set`; the last set stays, since an exercise with none is not planned. */
export function withoutSet(draft: Draft, exercise: number, set: number): Draft {
  const held = draft.exercises[exercise];
  if (!held || held.sets.length <= 1) return draft;
  const sets = held.sets.filter((_, at) => at !== set);
  return { ...draft, exercises: replaceAt(draft.exercises, exercise, { ...held, sets }) };
}

/** The sets of an exercise replaced by another's, as the engine gave them. */
export function withSetsFrom(draft: Draft, exercise: number, sets: DraftSet[]): Draft {
  const held = draft.exercises[exercise];
  if (!held || sets.length === 0) return draft;
  return {
    ...draft,
    exercises: replaceAt(draft.exercises, exercise, {
      ...held,
      sets: sets.map((set) => ({ ...set })),
    }),
  };
}

/** The sets `source` holds for the same exercise as `held`, or none. */
export function setsOfSame(source: DraftExercise[], held: DraftExercise): DraftSet[] {
  return (
    source.find((other) => other.category === held.category && other.name === held.name)?.sets ?? []
  );
}

/** The draft a saved workout opens as. */
export function fromWorkout(
  workout: NonNullable<Methods['strength.workout']['result']['workout']>
): Draft {
  return {
    id: workout.id,
    name: workout.name,
    exercises: workout.exercises,
    groups: workout.groups,
  };
}

/**
 * The ask that puts a deleted workout back: what the phone held of it before the delete, with the
 * times its list row carried so it takes its old place in the list.
 */
export function restoreAsk(
  row: Methods['strength.workouts']['result']['workouts'][number],
  workout: NonNullable<Methods['strength.workout']['result']['workout']>
): Methods['strength.restoreWorkout']['params'] {
  return {
    id: workout.id,
    name: workout.name,
    exercises: workout.exercises,
    groups: workout.groups,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/** A new draft that starts from a recent group's exercises and the sets the engine read for them. */
export function fromGroup(group: Methods['strength.groups']['result']['groups'][number]): Draft {
  return { ...blankDraft(), exercises: group.exercises.map((exercise) => ({ ...exercise })) };
}

/** Whether the draft can be saved: it has a name and an exercise. */
export const canSave = (draft: Draft): boolean =>
  draft.name.trim() !== '' && draft.exercises.length > 0;

/** The ask that saves the draft as it stands. */
export const saveAsk = (draft: Draft): Methods['strength.saveWorkout']['params'] => ({
  id: draft.id,
  name: draft.name.trim(),
  exercises: draft.exercises,
  groups: draft.groups,
});

/** A number typed into a set's field: empty clears it, anything else must be a non-negative number. */
export function typedNumber(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** `category.name` as the key a name table reads. */
export const exerciseKey = (category: number, name: number | null): string =>
  `${category}.${name ?? ''}`;

/**
 * The names the picker's rows carry, by exercise key. The picker always sends a name number, while
 * an exercise the athlete did without one carries none, so each category also answers to the
 * absent name: with its row for name zero, or the first row the category has.
 */
export function namesOf(rows: PickerRow[]): Map<string, string> {
  const names = new Map(rows.map((row) => [exerciseKey(row.category, row.name), row.displayName]));
  const unnamed = new Map<number, string>();
  for (const row of rows) {
    if (row.name === 0 || !unnamed.has(row.category)) unnamed.set(row.category, row.displayName);
  }
  for (const [category, displayName] of unnamed)
    names.set(exerciseKey(category, null), displayName);
  return names;
}
