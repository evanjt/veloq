import {
  FfiPlanLineKind,
  FfiPlannedCategory,
  type FfiPlanLine,
  type FfiPlannedEvent,
} from 'veloqrs';
import {
  advance,
  followablePlan,
  formatLineDuration,
  planText,
  remainingSeconds,
  startFollow,
  syncFollow,
  type PlanLine,
} from '@/features/recording/lib/planFollow';

const SEC = 1000;

const work = (text: string, durationSeconds: number | null = null): PlanLine => ({
  kind: 'work',
  text,
  durationSeconds,
});
const rest = (text: string, durationSeconds: number): PlanLine => ({
  kind: 'rest',
  text,
  durationSeconds,
});

describe('planText', () => {
  it('joins the lines with their durations, one per line', () => {
    expect(planText([work('Squats', 90), work('Press')])).toBe('Squats 1m30s\nPress');
  });
});

describe('formatLineDuration', () => {
  it('writes the on-screen duration in the locale units, minutes as min', () => {
    expect(formatLineDuration(90)).toBe('1 min 30 s');
    expect(formatLineDuration(45)).toBe('45 s');
    expect(formatLineDuration(300)).toBe('5 min');
  });

  it('leaves the uploaded description in the workout syntax', () => {
    expect(planText([work('Rows', 300)])).toBe('Rows 5m');
  });
});

describe('follow state', () => {
  const lines = [work('A', 10), work('B'), rest('Rest', 5)];

  it('starts on the first line with its countdown', () => {
    const s = startFollow(lines, 0);
    expect(s.index).toBe(0);
    expect(remainingSeconds(s, 3 * SEC)).toBe(7);
  });

  it('a timed line advances itself when its time is up', () => {
    const s = syncFollow(startFollow(lines, 0), 10 * SEC);
    expect(s.index).toBe(1);
    expect(remainingSeconds(s, 12 * SEC)).toBeNull();
  });

  it('does not advance early, and an untimed line never advances itself', () => {
    expect(syncFollow(startFollow(lines, 0), 9_999).index).toBe(0);
    const onB = syncFollow(startFollow(lines, 0), 10 * SEC);
    expect(syncFollow(onB, 10 * SEC + 3600 * SEC).index).toBe(1);
  });

  it('a tick advances to the next line and restarts its clock', () => {
    const onB = advance(startFollow(lines, 0), 4 * SEC);
    expect(onB.index).toBe(1);
    const onRest = advance(onB, 20 * SEC);
    expect(onRest.index).toBe(2);
    expect(remainingSeconds(onRest, 22 * SEC)).toBe(3);
  });

  it('catches up through several expired lines after the app was backgrounded', () => {
    const timed = [work('A', 10), work('B', 10), work('C', 10)];
    const s = syncFollow(startFollow(timed, 0), 25 * SEC);
    expect(s.index).toBe(2);
    expect(remainingSeconds(s, 25 * SEC)).toBe(5);
  });

  it('the last line ending finishes the session at its own boundary', () => {
    const timed = [work('A', 10), work('B', 10)];
    const s = syncFollow(startFollow(timed, 1000), 500 * SEC);
    expect(s.finishedAt).toBe(1000 + 20 * SEC);
  });

  it('a tick on the last line finishes at the tick time, and later ticks change nothing', () => {
    const one = [work('A')];
    const done = advance(startFollow(one, 0), 42 * SEC);
    expect(done.finishedAt).toBe(42 * SEC);
    expect(advance(done, 99 * SEC)).toBe(done);
    expect(syncFollow(done, 99 * SEC)).toBe(done);
  });

  it('an empty plan is finished at once', () => {
    expect(startFollow([], 5).finishedAt).toBe(5);
  });
});

describe('followablePlan', () => {
  const line = (text: string): FfiPlanLine => ({ kind: FfiPlanLineKind.Work, text, targets: [] });
  const event = (id: number, lines: FfiPlanLine[]): FfiPlannedEvent => ({
    id,
    name: 'Legs',
    day: '2026-01-02',
    sport: 'WeightTraining',
    category: FfiPlannedCategory.Workout,
    lines,
    bar: [],
  });

  it('finds the paired event and names it', () => {
    const plan = followablePlan([event(1, []), event(2, [line('Squats')])], 2);
    expect(plan).toEqual({ name: 'Legs', lines: [work('Squats')] });
  });

  it('is null with no event or nothing to follow', () => {
    expect(followablePlan([], 2)).toBeNull();
    expect(followablePlan([event(2, [])], 2)).toBeNull();
    expect(followablePlan([event(1, [line('Squats')])], 2)).toBeNull();
  });
});
