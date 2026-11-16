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
import { answerAsk } from '../__shared__/connectPhoneShim';

const names = (methods as { methods: { name: string }[] }).methods.map((m) => m.name);
const script = demoScript({
  browserFingerprint: 'a',
  phoneProof: 'b',
  phoneFingerprint: 'c',
});

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
});
