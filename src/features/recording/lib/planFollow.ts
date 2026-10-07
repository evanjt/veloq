import type { CalendarEvent, WorkoutDoc, WorkoutStep } from '@/types';

/**
 * A step's target as the plan supplied it, a single value being a range of
 * one. `absolute` is there only when the plan carries a positive threshold to
 * convert a relative target by.
 */
export interface StepTarget {
  metric: 'power' | 'hr' | 'pace';
  low: number;
  high: number;
  units: string;
  absolute?: { low: number; high: number; units: 'W' | 'bpm' };
}

export interface PlanLine {
  kind: 'work' | 'rest';
  text: string;
  durationSeconds: number | null;
  /** A prescribed distance. Any duration beside it is an estimate, not a countdown. */
  distanceMetres?: number;
  targets?: StepTarget[];
}

/**
 * Progress through the plan. Every time is a reading of the clock the caller
 * follows on: the wall clock for a strength session, the recording's moving
 * clock for a ride or run, so a pause never counts. A distance is the recorded
 * distance, null where there is none to read.
 */
export interface FollowState {
  lines: readonly PlanLine[];
  index: number;
  startedAt: number;
  lineStartedAt: number;
  lineStartDistance: number | null;
  finishedAt: number | null;
}

/** The thresholds the plan carries, which relative targets convert by. */
export type PlanReferences = Partial<Pick<WorkoutDoc, 'ftp' | 'lthr' | 'threshold_pace'>>;

const MAX_LINES = 500;

function isRest(step: WorkoutStep): boolean {
  return step.intensity === 'rest' || /^rest\b/i.test(step.text ?? '');
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function target(
  metric: StepTarget['metric'],
  supplied: WorkoutStep['power'],
  refs: PlanReferences
): StepTarget | null {
  if (!supplied || typeof supplied !== 'object') return null;
  const value = finite(supplied.value);
  const start = finite(supplied.start) ?? value;
  const end = finite(supplied.end) ?? value ?? start;
  if (start == null || end == null) return null;
  const units = typeof supplied.units === 'string' ? supplied.units : '';
  const out: StepTarget = {
    metric,
    low: Math.min(start, end),
    high: Math.max(start, end),
    units,
  };
  // Pace is left as supplied: converting it needs the threshold's unit and
  // which way the percentage runs, and a wrong pace is worse than none.
  const ref =
    units === '%ftp' ? positive(refs.ftp) : units === '%lthr' ? positive(refs.lthr) : null;
  if (ref != null) {
    out.absolute = {
      low: Math.round((out.low * ref) / 100),
      high: Math.round((out.high * ref) / 100),
      units: units === '%ftp' ? 'W' : 'bpm',
    };
  }
  return out;
}

function stepTargets(step: WorkoutStep, refs: PlanReferences): StepTarget[] {
  const out: StepTarget[] = [];
  for (const [metric, supplied] of [
    ['power', step.power],
    ['hr', step.hr],
    ['pace', step.pace],
  ] as const) {
    const t = target(metric, supplied, refs);
    if (t) out.push(t);
  }
  return out;
}

function walk(steps: readonly unknown[], refs: PlanReferences, out: PlanLine[]): void {
  for (const raw of steps) {
    if (out.length >= MAX_LINES) return;
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as WorkoutStep;
    // A repeat's own duration and distance are its children's sum, not a step.
    if (Array.isArray(step.steps) && step.steps.length) {
      const reps = step.reps ?? 1;
      for (let i = 0; i < reps; i++) walk(step.steps, refs, out);
      continue;
    }
    const text = typeof step.text === 'string' ? step.text.trim() : '';
    const durationSeconds = positive(step.duration);
    const distanceMetres = positive(step.distance);
    const targets = stepTargets(step, refs);
    if (!text && durationSeconds == null && distanceMetres == null && targets.length === 0) {
      continue;
    }
    out.push({
      kind: isRest(step) ? 'rest' : 'work',
      text,
      durationSeconds,
      ...(distanceMetres != null ? { distanceMetres } : {}),
      ...(targets.length ? { targets } : {}),
    });
  }
}

/**
 * The plan as the flat list the athlete follows. Repeats expand in order. A
 * rest line exists only where the plan has a rest step: the plan prescribes no
 * rest between lines, so none is made up.
 */
export function expandPlan(steps: readonly unknown[], refs: PlanReferences = {}): PlanLine[] {
  const out: PlanLine[] = [];
  walk(steps, refs, out);
  return out;
}

function targetRange(low: number, high: number): string {
  return low === high ? `${low}` : `${low}–${high}`;
}

const RELATIVE_UNITS: Record<string, string> = {
  '%ftp': '% FTP',
  '%lthr': '% LTHR',
  '%hr': '% max HR',
  '%pace': '% pace',
};

const METRIC_NAMES: Record<StepTarget['metric'], string> = {
  power: 'power',
  hr: 'HR',
  pace: 'pace',
};

/** A target in the units the plan supplied, with its conversion where there is one. */
export function formatTarget(t: StepTarget): string {
  const range = targetRange(t.low, t.high);
  const units = t.units.toLowerCase();
  let text: string;
  if (RELATIVE_UNITS[units]) text = `${range}${RELATIVE_UNITS[units]}`;
  else if (units.endsWith('_zone')) text = `Z${range} ${METRIC_NAMES[t.metric]}`;
  else if (units === 'w' || units === 'watts') text = `${range} W`;
  else if (units === 'bpm') text = `${range} bpm`;
  else if (units) text = `${range} ${t.units}`;
  else text = `${range} ${METRIC_NAMES[t.metric]}`;
  if (!t.absolute) return text;
  return `${text} (${targetRange(t.absolute.low, t.absolute.high)} ${t.absolute.units})`;
}

export function formatLineDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

/** The description the uploaded activity carries: one line per plan line. */
export function planText(lines: readonly PlanLine[]): string {
  return lines
    .map((l) =>
      l.durationSeconds != null
        ? `${l.text} ${formatLineDuration(l.durationSeconds)}`.trim()
        : l.text
    )
    .join('\n');
}

export function startFollow(
  lines: readonly PlanLine[],
  now: number,
  distance: number | null = null
): FollowState {
  return {
    lines,
    index: 0,
    startedAt: now,
    lineStartedAt: now,
    lineStartDistance: distance,
    finishedAt: lines.length === 0 ? now : null,
  };
}

function next(state: FollowState, at: number, distance: number | null): FollowState {
  if (state.index + 1 >= state.lines.length) return { ...state, finishedAt: at };
  return { ...state, index: state.index + 1, lineStartedAt: at, lineStartDistance: distance };
}

/** The athlete ticked the current line off. */
export function advance(
  state: FollowState,
  now: number,
  distance: number | null = null
): FollowState {
  if (state.finishedAt != null) return state;
  return next(state, now, distance);
}

/**
 * Advances every line whose prescription has been met. A distance line ends
 * on the distance covered since it began, whatever its estimated duration, and
 * never without a distance to read. A timed line ends at its own boundary
 * rather than at `now`, so a screen that slept through several lines lands on
 * the right one and a finished session keeps its true length. A line with
 * neither waits for the athlete.
 */
export function syncFollow(
  state: FollowState,
  now: number,
  distance: number | null = null
): FollowState {
  let s = state;
  while (s.finishedAt == null) {
    const line = s.lines[s.index];
    if (!line) break;
    if (line.distanceMetres != null) {
      if (distance == null) break;
      if (s.lineStartDistance == null) {
        s = { ...s, lineStartDistance: distance };
        continue;
      }
      const end = s.lineStartDistance + line.distanceMetres;
      if (distance < end) break;
      s = next(s, now, end);
      continue;
    }
    const secs = line.durationSeconds;
    if (secs == null) break;
    const end = s.lineStartedAt + secs * 1000;
    if (now < end) break;
    s = next(s, end, distance);
  }
  return s;
}

/** Whole seconds left on the current timed line, null on any other. */
export function remainingSeconds(state: FollowState, now: number): number | null {
  if (state.finishedAt != null) return null;
  const line = state.lines[state.index];
  if (line?.durationSeconds == null || line.distanceMetres != null) return null;
  const left = Math.ceil((state.lineStartedAt + line.durationSeconds * 1000 - now) / 1000);
  // A reading taken a moment before the line began never shows more than the line.
  return Math.min(line.durationSeconds, Math.max(0, left));
}

/** Metres left on the current distance line, null on any other or with no distance to read. */
export function remainingMetres(state: FollowState, distance: number | null): number | null {
  if (state.finishedAt != null || distance == null) return null;
  const metres = state.lines[state.index]?.distanceMetres;
  if (metres == null) return null;
  const from = state.lineStartDistance ?? distance;
  return Math.max(0, from + metres - distance);
}

/** The lines of a planned workout, null when the event has nothing to follow. */
export function followablePlan(
  events: readonly CalendarEvent[],
  eventId: number
): { name: string; lines: PlanLine[] } | null {
  const event = events.find((e) => e.id === eventId);
  const doc = event?.workout_doc;
  if (!event || !doc || !Array.isArray(doc.steps)) return null;
  const lines = expandPlan(doc.steps, doc);
  return lines.length > 0 ? { name: event.name, lines } : null;
}

/** The plan a recording follows, frozen when it starts, and the progress through it. */
export interface WorkoutFollow {
  name: string;
  follow: FollowState;
}

function isTarget(value: unknown): value is StepTarget {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  if (t.metric !== 'power' && t.metric !== 'hr' && t.metric !== 'pace') return false;
  if (finite(t.low) == null || finite(t.high) == null || typeof t.units !== 'string') return false;
  if (t.absolute === undefined) return true;
  const a = t.absolute as Record<string, unknown> | null;
  return (
    !!a && finite(a.low) != null && finite(a.high) != null && (a.units === 'W' || a.units === 'bpm')
  );
}

function isLine(value: unknown): value is PlanLine {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  if (l.kind !== 'work' && l.kind !== 'rest') return false;
  if (typeof l.text !== 'string') return false;
  if (l.durationSeconds !== null && positive(l.durationSeconds) == null) return false;
  if (l.distanceMetres !== undefined && positive(l.distanceMetres) == null) return false;
  if (l.targets !== undefined && !(Array.isArray(l.targets) && l.targets.every(isTarget))) {
    return false;
  }
  return true;
}

/**
 * A followed plan read back from storage, or null when it is absent or does
 * not hold together. Losing the guidance never loses the recording.
 */
export function readWorkoutFollow(value: unknown): WorkoutFollow | null {
  if (!value || typeof value !== 'object') return null;
  const w = value as Record<string, unknown>;
  const f = w.follow as Record<string, unknown> | null | undefined;
  if (typeof w.name !== 'string' || !f || typeof f !== 'object') return null;
  if (!Array.isArray(f.lines) || f.lines.length === 0 || !f.lines.every(isLine)) return null;
  const { index } = f;
  if (typeof index !== 'number' || !Number.isInteger(index)) return null;
  if (index < 0 || index >= f.lines.length) return null;
  if (finite(f.startedAt) == null || finite(f.lineStartedAt) == null) return null;
  if (f.lineStartDistance !== null && finite(f.lineStartDistance) == null) return null;
  if (f.finishedAt !== null && finite(f.finishedAt) == null) return null;
  return {
    name: w.name,
    follow: {
      lines: f.lines,
      index,
      startedAt: f.startedAt as number,
      lineStartedAt: f.lineStartedAt as number,
      lineStartDistance: f.lineStartDistance as number | null,
      finishedAt: f.finishedAt as number | null,
    },
  };
}
