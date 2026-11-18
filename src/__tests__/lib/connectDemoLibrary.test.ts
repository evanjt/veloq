/**
 * Scenario: the scripted phone that stands in for a real library in the connect page's screenshots
 * and dev server.
 * Expected behaviour: it answers every method the protocol names, with the engine's own encodings,
 * so no page or detail view meets an unknown method or a stream that reads as nonsense.
 */

import methods from '../../../web/connect/methods.json';
import { doublesOf } from '../../../web/connect/activity';
import {
  ACTIVITIES,
  LIBRARY_END,
  SHOWN_ACTIVITY,
  demoResults,
  demoScript,
} from '../__shared__/connectDemoLibrary';
import { answerAsk, keepWrite } from '../__shared__/connectPhoneShim';

const names = (methods as { methods: { name: string }[] }).methods.map((m) => m.name);
const script = demoScript({
  browserFingerprint: 'a',
  phoneProof: 'b',
  phoneFingerprint: 'c',
});

const freshPhone = () =>
  demoScript({ browserFingerprint: 'a', phoneProof: 'b', phoneFingerprint: 'c' });

/** A save as the builder sends it: one exercise of one set, with the invented category 3. */
const draft = (name: string) => ({
  id: null,
  name,
  exercises: [
    {
      category: 3,
      name: null,
      groupNo: null,
      restSecs: 60,
      sets: [{ reps: 8, weightKg: 20, durationSecs: null, side: null, warmUp: false }],
    },
  ],
  groups: [],
});

/** Saves an ask on a phone the way the page does: the answer, then what the phone keeps of it. */
function save(phone: ReturnType<typeof freshPhone>, ask: ReturnType<typeof draft>) {
  const answer = answerAsk(phone, 'strength.saveWorkout', ask).result as { id: string };
  keepWrite(phone, 'strength.saveWorkout', ask, answer);
  return answer.id;
}

/** The methods whose ask names one activity, and whose rows the phone keys by its id. */
const PER_ACTIVITY = [
  'activity.summary',
  'activity.detail',
  'activity.record',
  'activity.streams',
  'activity.intervals',
  'activity.sections',
  'activity.exerciseSets',
  'geo.track',
  'geo.activityOverlay',
];

describe('the demo library', () => {
  it('has an answer for every method in methods.json', () => {
    const answered = new Set(Object.keys(demoResults()));
    expect(names.filter((name) => !answered.has(name))).toEqual([]);
  });

  it('has a row for every activity of the library in every per-activity method', () => {
    for (const method of PER_ACTIVITY) {
      const answered = new Set(Object.keys(script.byActivity?.[method] ?? {}));
      expect({
        method,
        missing: ACTIVITIES.filter((a) => !answered.has(a.id)).map((a) => a.id),
      }).toEqual({ method, missing: [] });
    }
  });

  it('answers an activity the library does not hold with an error and not with another record', () => {
    const unheld = 'unheld-activity';
    expect(ACTIVITIES.some((a) => a.id === unheld)).toBe(false);
    expect(answerAsk(script, 'activity.record', { id: unheld })).toEqual({
      error: expect.any(String),
    });
  });

  it('answers an activity the library holds with its own record', () => {
    const own = ACTIVITIES[0] as (typeof ACTIVITIES)[number];
    expect(answerAsk(script, 'activity.record', { id: own.id })).toEqual({
      result: { record: expect.objectContaining({ id: own.id, name: own.name }) },
    });
  });

  it('lists every method in the hello it sends', () => {
    expect(names.filter((name) => !script.methods.includes(name))).toEqual([]);
  });

  it('writes streams as 64-bit floats whose values are plausible', () => {
    const streams = (script.byActivity?.['activity.streams'] ?? {})[SHOWN_ACTIVITY] as Record<
      string,
      string
    >;
    const time = doublesOf(streams.time as string);
    expect(time.length).toBeGreaterThan(100);
    expect(Math.max(...time)).toBeLessThan(86_400);
    const speed = doublesOf(streams.velocitySmooth as string);
    expect(speed).toHaveLength(time.length);
    expect(Math.max(...speed)).toBeLessThan(30);
    expect(Math.min(...speed)).toBeGreaterThanOrEqual(0);
    const heart = doublesOf(streams.heartrate as string);
    expect(Math.min(...heart)).toBeGreaterThanOrEqual(40);
    expect(Math.max(...heart)).toBeLessThanOrEqual(220);
    const distance = doublesOf(streams.distance as string);
    expect(Math.max(...distance)).toBeLessThan(500_000);
  });

  it('dates recordings in milliseconds, as the engine does', () => {
    const recordings = demoResults()['recordings.list'].recordings;
    expect(recordings.length).toBeGreaterThan(0);
    for (const recording of recordings) {
      for (const at of [recording.startTime, recording.createdAt]) {
        expect(at).toBeGreaterThan(Date.UTC(2020, 0, 1));
        expect(at).toBeLessThanOrEqual(LIBRARY_END);
      }
    }
  });

  it('gives every outdoor activity a track', () => {
    const geo = script.byActivity?.['geo.track'] ?? {};
    const outdoor = ACTIVITIES.filter((a) => a.sport.gps);
    expect(outdoor.length).toBeGreaterThan(50);
    for (const a of outdoor) {
      const text = (geo[a.id] as { text: string } | undefined)?.text;
      expect(text).toBeDefined();
      expect(JSON.parse(text as string).features.length).toBeGreaterThan(0);
    }
  });

  it('gives every route with a chart of attempts a trend band the over-time chart can draw', () => {
    const answers = Object.values(script.byActivity?.['route.performance'] ?? {}) as {
      chartData: { points: unknown[] };
      trendCurves: { forwardTime: { value: number; lower: number; upper: number }[] | null };
    }[];
    const charted = answers.filter((answer) => answer.chartData.points.length >= 2);
    expect(charted.length).toBeGreaterThan(0);
    for (const answer of charted) {
      const band = answer.trendCurves.forwardTime ?? [];
      expect(band.length).toBeGreaterThan(1);
      for (const point of band) {
        expect(point.lower).toBeLessThanOrEqual(point.value);
        expect(point.value).toBeLessThanOrEqual(point.upper);
      }
    }
  });

  it('counts the auto sections it has not accepted, and flags each of them on its row', () => {
    const screen = demoResults()['routes.screen'];
    const auto = screen.sections.filter((section) => section.sectionType === 'auto');
    const awaiting = auto.filter((section) => !section.isUserDefined && !section.disabled);
    expect(awaiting.length).toBeGreaterThan(0);
    expect(screen.unacceptedAutoCount).toBe(awaiting.length);
    expect(screen.acceptedAutoCount).toBe(auto.length - awaiting.length);
  });
});

describe('the workouts the demo phone keeps', () => {
  it('reads back a saved workout under the id the save answered with, as it was sent', () => {
    const phone = freshPhone();
    const ask = draft('Mobility');
    const id = save(phone, ask);
    expect(answerAsk(phone, 'strength.workout', { id })).toEqual({
      result: { workout: { id, name: 'Mobility', exercises: ask.exercises, groups: [] } },
    });
  });

  it('lists a saved workout beside the library’s, with its exercise and set counts', () => {
    const phone = freshPhone();
    const listed = () =>
      (answerAsk(phone, 'strength.workouts', {}).result as { workouts: { id: string }[] }).workouts;
    const before = listed().length;
    const id = save(phone, draft('Mobility'));
    const rows = listed();
    expect(rows).toHaveLength(before + 1);
    expect(rows).toContainEqual(
      expect.objectContaining({ id, name: 'Mobility', exerciseCount: 1, setCount: 1 })
    );
    expect(answerAsk(phone, 'strength.workout', { id: 'workout-1' })).toMatchObject({
      result: { workout: { id: 'workout-1' } },
    });
  });

  it('reads a renamed workout back under its new name, in the read and in the list', () => {
    const phone = freshPhone();
    const id = save(phone, draft('Mobility'));
    keepWrite(phone, 'strength.renameWorkout', { id, name: 'Hips' }, {});
    expect(answerAsk(phone, 'strength.workout', { id })).toMatchObject({
      result: { workout: { name: 'Hips' } },
    });
    const rows = (
      answerAsk(phone, 'strength.workouts', {}).result as {
        workouts: { id: string; name: string }[];
      }
    ).workouts;
    expect(rows.filter((row) => row.id === id).map((row) => row.name)).toEqual(['Hips']);
  });
});
