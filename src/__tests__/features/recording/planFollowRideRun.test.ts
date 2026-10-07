import {
  advance,
  expandPlan,
  followablePlan,
  formatTarget,
  remainingMetres,
  remainingSeconds,
  startFollow,
  syncFollow,
} from '@/features/recording/lib/planFollow';
import type { CalendarEvent, WorkoutStep } from '@/types';

const SEC = 1000;

const intervals: WorkoutStep[] = [
  { text: 'Warm up', duration: 600, warmup: true },
  {
    reps: 2,
    duration: 360,
    distance: 1600,
    steps: [
      { text: 'Hard', duration: 240, distance: 1200 },
      { text: 'Float', duration: 120, intensity: 'rest' },
    ],
  },
];

describe('expandPlan for a ride or run', () => {
  it('expands repeats in order and never makes the parent a step of its own', () => {
    const lines = expandPlan(intervals);
    expect(lines.map((l) => l.text)).toEqual(['Warm up', 'Hard', 'Float', 'Hard', 'Float']);
    expect(lines.map((l) => l.distanceMetres ?? null)).toEqual([null, 1200, null, 1200, null]);
  });

  it('keeps a step that has only a distance, or only a target', () => {
    const lines = expandPlan([
      { distance: 1000 },
      { pace: { start: 90, end: 95, units: '%pace' } },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].distanceMetres).toBe(1000);
    expect(lines[1].targets).toHaveLength(1);
  });
});

describe('timed steps on the active clock', () => {
  const lines = expandPlan([
    { text: 'A', duration: 120 },
    { text: 'B', duration: 60 },
    { text: 'C', duration: 60 },
    { text: 'D', duration: 60 },
  ]);

  it('counts the active clock it is given, so paused time never shows up', () => {
    // The caller's clock is the recording's moving time: 30 active seconds,
    // then a 60-second pause the moving clock does not advance through.
    const s = syncFollow(startFollow(lines, 0, null), 30 * SEC, null);
    expect(s.index).toBe(0);
    expect(remainingSeconds(s, 30 * SEC)).toBe(90);
  });

  it('crosses several timed steps once each when the screen catches up after a long gap', () => {
    const s = syncFollow(startFollow(lines, 0, null), 250 * SEC, null);
    expect(s.index).toBe(3);
    expect(s.lineStartedAt).toBe(240 * SEC);
    expect(remainingSeconds(s, 250 * SEC)).toBe(50);
    // A second sync at the same moment is a no-op, not another crossing.
    expect(syncFollow(s, 250 * SEC, null)).toBe(s);
  });

  it('never shows more than the step itself when read a moment before it began', () => {
    const s = advance(startFollow(lines, 0, null), 100 * SEC, null);
    expect(remainingSeconds(s, 99.4 * SEC)).toBe(60);
  });
});

describe('distance steps', () => {
  const lines = expandPlan([
    { text: 'Kilometre', distance: 1000, duration: 300 },
    { text: 'Jog', duration: 60 },
  ]);

  it('holds a distance step past its estimated duration until the distance is covered', () => {
    const s = syncFollow(startFollow(lines, 0, 0), 300 * SEC, 800);
    expect(s.index).toBe(0);
    expect(remainingMetres(s, 800)).toBe(200);
    // The supplied duration on a distance step is an estimate, not a countdown.
    expect(remainingSeconds(s, 300 * SEC)).toBeNull();
  });

  it('completes the distance step at its distance, measured from where it started', () => {
    const atStart = syncFollow(startFollow(lines, 0, 0), 10 * SEC, 250);
    const s = syncFollow(atStart, 330 * SEC, 1000);
    expect(s.index).toBe(1);
    expect(s.lineStartedAt).toBe(330 * SEC);
    expect(s.lineStartDistance).toBe(1000);
    expect(remainingSeconds(s, 330 * SEC)).toBe(60);
  });

  it('measures a later distance step from the distance it started at', () => {
    const two = expandPlan([{ distance: 500 }, { distance: 500 }, { text: 'Done' }]);
    let s = startFollow(two, 0, 2000);
    s = syncFollow(s, 100 * SEC, 2499);
    expect(s.index).toBe(0);
    s = syncFollow(s, 110 * SEC, 2510);
    expect(s.index).toBe(1);
    expect(s.lineStartDistance).toBe(2500);
    s = syncFollow(s, 200 * SEC, 3000);
    expect(s.index).toBe(2);
  });

  it('never completes a distance step without distance data, and lets the athlete advance it', () => {
    let s = syncFollow(startFollow(lines, 0, null), 3600 * SEC, null);
    expect(s.index).toBe(0);
    expect(remainingMetres(s, null)).toBeNull();
    s = advance(s, 3600 * SEC, null);
    expect(s.index).toBe(1);
  });

  it('starts measuring a distance step once distance becomes available', () => {
    let s = syncFollow(startFollow(lines, 0, null), 10 * SEC, 400);
    expect(s.index).toBe(0);
    expect(remainingMetres(s, 400)).toBe(1000);
    s = syncFollow(s, 200 * SEC, 1400);
    expect(s.index).toBe(1);
  });
});

describe('untimed steps and the end of the plan', () => {
  it('never completes an untimed step on its own', () => {
    const lines = expandPlan([{ text: 'Easy until the bridge' }, { text: 'Home', duration: 60 }]);
    const s = syncFollow(startFollow(lines, 0, 0), 7200 * SEC, 30000);
    expect(s.index).toBe(0);
    expect(s.finishedAt).toBeNull();
    expect(advance(s, 7200 * SEC, 30000).index).toBe(1);
  });

  it('marks the plan finished at the last step boundary', () => {
    const lines = expandPlan([{ text: 'Only', duration: 60 }]);
    const s = syncFollow(startFollow(lines, 0, null), 90 * SEC, null);
    expect(s.finishedAt).toBe(60 * SEC);
    expect(advance(s, 95 * SEC, null)).toBe(s);
  });
});

describe('targets', () => {
  it('shows a pace range in its supplied units without inventing an absolute pace', () => {
    const [line] = expandPlan([{ distance: 1000, pace: { start: 90, end: 95, units: '%pace' } }], {
      threshold_pace: 4.2,
    });
    expect(line.targets?.map(formatTarget)).toEqual(['90–95% pace']);
  });

  it('converts a relative heart-rate target only with a threshold to convert it by', () => {
    const step: WorkoutStep = { duration: 600, hr: { start: 75, end: 85, units: '%lthr' } };
    const [withRef] = expandPlan([step], { lthr: 170 });
    expect(withRef.targets?.map(formatTarget)).toEqual(['75–85% LTHR (128–145 bpm)']);
    for (const lthr of [undefined, 0, -1, NaN]) {
      const [noRef] = expandPlan([step], { lthr } as { lthr: number });
      expect(noRef.targets?.map(formatTarget)).toEqual(['75–85% LTHR']);
    }
  });

  it('converts a power target relative to FTP, and keeps absolute watts as watts', () => {
    const [relative, absolute, zone] = expandPlan(
      [
        { duration: 300, power: { value: 105, units: '%ftp' } },
        { duration: 300, power: { start: 200, end: 220, units: 'w' } },
        { duration: 300, power: { value: 2, units: 'power_zone' } },
      ],
      { ftp: 250 }
    );
    expect(relative.targets?.map(formatTarget)).toEqual(['105% FTP (263 W)']);
    expect(absolute.targets?.map(formatTarget)).toEqual(['200–220 W']);
    expect(zone.targets?.map(formatTarget)).toEqual(['Z2 power']);
  });

  it('leaves out a target that carries no number rather than showing zero', () => {
    const [line] = expandPlan([{ duration: 60, power: { units: '%ftp' } }], { ftp: 250 });
    expect(line.targets ?? []).toEqual([]);
  });
});

describe('followablePlan', () => {
  const event = (doc: unknown): CalendarEvent =>
    ({ id: 7, name: 'Track session', workout_doc: doc }) as unknown as CalendarEvent;

  it('carries the plan reference into the targets', () => {
    const plan = followablePlan(
      [event({ steps: [{ duration: 60, hr: { value: 80, units: '%lthr' } }], lthr: 150 })],
      7
    );
    expect(plan?.lines[0].targets?.map(formatTarget)).toEqual(['80% LTHR (120 bpm)']);
  });

  it('gives nothing to follow for an empty, missing or malformed plan', () => {
    expect(followablePlan([event({ steps: [] })], 7)).toBeNull();
    expect(followablePlan([event(null)], 7)).toBeNull();
    expect(followablePlan([event({ steps: 'not a list' })], 7)).toBeNull();
    expect(followablePlan([event({ steps: [null, 3, 'x'] })], 7)).toBeNull();
    expect(followablePlan([event({ steps: [{ text: 'A', duration: 60 }] })], 8)).toBeNull();
  });
});
