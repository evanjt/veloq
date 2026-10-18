import {
  FfiAbsoluteUnits,
  FfiPlanLineKind,
  FfiPlannedCategory,
  FfiTargetMetric,
  type FfiPlanLine,
  type FfiPlannedEvent,
} from 'veloqrs';
import {
  advance,
  followablePlan,
  formatTarget,
  readWorkoutFollow,
  remainingMetres,
  remainingSeconds,
  startFollow,
  syncFollow,
  type PlanLine,
} from '@/features/recording/lib/planFollow';

const SEC = 1000;

const timed = (text: string, durationSeconds: number | null): PlanLine => ({
  kind: 'work',
  text,
  durationSeconds,
});
const distance = (text: string, distanceMetres: number, durationSeconds: number | null = null) => ({
  ...timed(text, durationSeconds),
  distanceMetres,
});

describe('timed steps on the active clock', () => {
  const lines = [timed('A', 120), timed('B', 60), timed('C', 60), timed('D', 60)];

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
  const lines = [distance('Kilometre', 1000, 300), timed('Jog', 60)];

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
    const two = [distance('', 500), distance('', 500), timed('Done', null)];
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
    const lines = [timed('Easy until the bridge', null), timed('Home', 60)];
    const s = syncFollow(startFollow(lines, 0, 0), 7200 * SEC, 30000);
    expect(s.index).toBe(0);
    expect(s.finishedAt).toBeNull();
    expect(advance(s, 7200 * SEC, 30000).index).toBe(1);
  });

  it('marks the plan finished at the last step boundary', () => {
    const lines = [timed('Only', 60)];
    const s = syncFollow(startFollow(lines, 0, null), 90 * SEC, null);
    expect(s.finishedAt).toBe(60 * SEC);
    expect(advance(s, 95 * SEC, null)).toBe(s);
  });
});

describe('targets', () => {
  it('shows a pace range in its supplied units without an absolute pace', () => {
    expect(formatTarget({ metric: 'pace', low: 90, high: 95, units: '%pace' })).toBe('90–95% pace');
  });

  it('shows a relative heart-rate target with its conversion where it has one', () => {
    const relative = { metric: 'hr', low: 75, high: 85, units: '%lthr' } as const;
    expect(formatTarget(relative)).toBe('75–85% LTHR');
    expect(formatTarget({ ...relative, absolute: { low: 128, high: 145, units: 'bpm' } })).toBe(
      '75–85% LTHR (128–145 bpm)'
    );
  });

  it('shows power relative to FTP, absolute watts and a zone in their own terms', () => {
    expect(
      formatTarget({
        metric: 'power',
        low: 105,
        high: 105,
        units: '%ftp',
        absolute: { low: 263, high: 263, units: 'W' },
      })
    ).toBe('105% FTP (263 W)');
    expect(formatTarget({ metric: 'power', low: 200, high: 220, units: 'w' })).toBe('200–220 W');
    expect(formatTarget({ metric: 'power', low: 2, high: 2, units: 'power_zone' })).toBe(
      'Z2 power'
    );
  });
});

describe('followablePlan', () => {
  const event = (lines: FfiPlanLine[]): FfiPlannedEvent => ({
    id: 7,
    name: 'Track session',
    day: '2026-01-02',
    sport: 'Run',
    category: FfiPlannedCategory.Workout,
    lines,
    bar: [],
  });

  it('takes the engine lines in the shape a recording freezes', () => {
    const plan = followablePlan(
      [
        event([
          {
            kind: FfiPlanLineKind.Work,
            text: 'Hard',
            durationSeconds: 240,
            distanceMetres: 1200,
            targets: [
              {
                metric: FfiTargetMetric.HeartRate,
                low: 80,
                high: 80,
                units: '%lthr',
                absolute: { low: 120, high: 120, units: FfiAbsoluteUnits.Bpm },
              },
              {
                metric: FfiTargetMetric.Power,
                low: 90,
                high: 95,
                units: '%ftp',
                absolute: { low: 225, high: 238, units: FfiAbsoluteUnits.Watts },
              },
              { metric: FfiTargetMetric.Pace, low: 90, high: 95, units: '%pace' },
            ],
          },
          { kind: FfiPlanLineKind.Rest, text: 'Float', targets: [] },
        ]),
      ],
      7
    );
    expect(plan?.lines).toEqual([
      {
        kind: 'work',
        text: 'Hard',
        durationSeconds: 240,
        distanceMetres: 1200,
        targets: [
          {
            metric: 'hr',
            low: 80,
            high: 80,
            units: '%lthr',
            absolute: { low: 120, high: 120, units: 'bpm' },
          },
          {
            metric: 'power',
            low: 90,
            high: 95,
            units: '%ftp',
            absolute: { low: 225, high: 238, units: 'W' },
          },
          { metric: 'pace', low: 90, high: 95, units: '%pace' },
        ],
      },
      { kind: 'rest', text: 'Float', durationSeconds: null },
    ]);
    expect(plan?.lines[0].targets?.map(formatTarget)[0]).toBe('80% LTHR (120 bpm)');
    // A recording freezes these lines into its crash backup, which reads them back.
    const follow = startFollow(plan?.lines ?? [], 0, 0);
    expect(readWorkoutFollow({ name: 'Track session', follow })?.follow.lines).toEqual(plan?.lines);
  });

  it('gives nothing to follow for an empty plan or another event', () => {
    expect(followablePlan([event([])], 7)).toBeNull();
    expect(
      followablePlan([event([{ kind: FfiPlanLineKind.Work, text: 'A', targets: [] }])], 8)
    ).toBeNull();
  });
});
