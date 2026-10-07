import {
  advance,
  expandPlan,
  followablePlan,
  planText,
  remainingSeconds,
  startFollow,
  syncFollow,
} from '@/features/recording/lib/planFollow';
import type { CalendarEvent, WorkoutStep } from '@/types';

const SEC = 1000;

describe('expandPlan', () => {
  it('lists text lines in order with their durations', () => {
    const lines = expandPlan([{ text: 'Squats', duration: 60 }, { text: 'Press' }]);
    expect(lines).toEqual([
      { kind: 'work', text: 'Squats', durationSeconds: 60 },
      { kind: 'work', text: 'Press', durationSeconds: null },
    ]);
  });

  it('expands a repeat block in order, reps times', () => {
    const steps: WorkoutStep[] = [
      { text: 'Warm up', duration: 30 },
      {
        reps: 2,
        steps: [
          { text: 'Row', duration: 40 },
          { text: 'Rest', duration: 20, intensity: 'rest' },
        ],
      },
    ];
    expect(expandPlan(steps).map((l) => [l.kind, l.text])).toEqual([
      ['work', 'Warm up'],
      ['work', 'Row'],
      ['rest', 'Rest'],
      ['work', 'Row'],
      ['rest', 'Rest'],
    ]);
  });

  it('expands nested repeats', () => {
    const lines = expandPlan([{ reps: 2, steps: [{ reps: 3, steps: [{ text: 'Curl' }] }] }]);
    expect(lines).toHaveLength(6);
  });

  it('treats a rest step as rest by intensity, and never invents one between lines', () => {
    const lines = expandPlan([
      { text: 'A', duration: 10 },
      { text: 'B', duration: 10 },
      { duration: 45, intensity: 'rest' },
    ]);
    expect(lines.map((l) => l.kind)).toEqual(['work', 'work', 'rest']);
  });

  it('drops a step with neither text nor duration, and a repeat of zero or none', () => {
    expect(expandPlan([{}, { reps: 0, steps: [{ text: 'X' }] }, { text: 'Y' }])).toHaveLength(1);
    expect(expandPlan([])).toEqual([]);
  });

  it('keeps a repeat without a count once', () => {
    expect(expandPlan([{ steps: [{ text: 'X' }] }])).toHaveLength(1);
  });
});

describe('planText', () => {
  it('joins the lines with their durations, one per line', () => {
    const lines = expandPlan([{ text: 'Squats', duration: 90 }, { text: 'Press' }]);
    expect(planText(lines)).toBe('Squats 1m30s\nPress');
  });
});

describe('follow state', () => {
  const lines = expandPlan([
    { text: 'A', duration: 10 },
    { text: 'B' },
    { text: 'Rest', duration: 5, intensity: 'rest' },
  ]);

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
    const timed = expandPlan([
      { text: 'A', duration: 10 },
      { text: 'B', duration: 10 },
      { text: 'C', duration: 10 },
    ]);
    const s = syncFollow(startFollow(timed, 0), 25 * SEC);
    expect(s.index).toBe(2);
    expect(remainingSeconds(s, 25 * SEC)).toBe(5);
  });

  it('the last line ending finishes the session at its own boundary', () => {
    const timed = expandPlan([
      { text: 'A', duration: 10 },
      { text: 'B', duration: 10 },
    ]);
    const s = syncFollow(startFollow(timed, 1000), 500 * SEC);
    expect(s.finishedAt).toBe(1000 + 20 * SEC);
  });

  it('a tick on the last line finishes at the tick time, and later ticks change nothing', () => {
    const one = expandPlan([{ text: 'A' }]);
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
  const event = (id: number, steps: WorkoutStep[] | null): CalendarEvent =>
    ({
      id,
      name: 'Legs',
      workout_doc: steps ? { steps, duration: 0, target: '' } : null,
    }) as CalendarEvent;

  it('finds the paired event and names it', () => {
    const plan = followablePlan([event(1, null), event(2, [{ text: 'Squats' }])], 2);
    expect(plan?.name).toBe('Legs');
    expect(plan?.lines).toHaveLength(1);
  });

  it('is null with no event, no workout doc, or nothing to follow', () => {
    expect(followablePlan([], 2)).toBeNull();
    expect(followablePlan([event(2, null)], 2)).toBeNull();
    expect(followablePlan([event(2, [{}])], 2)).toBeNull();
  });
});
