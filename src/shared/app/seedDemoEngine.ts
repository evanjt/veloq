/**
 * Seed the Rust engine from the bundled demo fixtures.
 *
 * Demo mode was a pure-TypeScript fork: a mock client answered every read
 * while live mode read SQLite, leaving two data paths to keep in step. The
 * fixtures now go into the same tables a live sync fills, so every downstream
 * read is identical in both modes and a hook can stop caring which it is.
 *
 * Every writer is an upsert, so seeding twice rewrites the same rows. GPS
 * tracks are not seeded here - `fetchDemoGps` already loads them through the
 * engine, and it owns the section-detection run that follows.
 */

import { toActivityMetrics } from '@/features/activity/lib/activityMetrics';
import { applyDetectionStrictness, getRouteEngine } from '@/shared/native/routeEngine';
import type { Activity, WellnessData } from '@/types';

/** The curve windows the stats screens request. */
const POWER_CURVE_WINDOWS = [42, 90, 365];
const PACE_CURVE_WINDOWS = [42, 90, 365];

type DemoEngine = NonNullable<ReturnType<typeof getRouteEngine>>;
type DemoCurves = typeof import('@/features/fitness/demo/curves');

/** Midnight today, in the epoch seconds the pace snapshot table keys on. */
function todayTimestamp(): number {
  return Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
}

export function seedDemoEngine(): void {
  const engine = getRouteEngine();
  if (!engine) return;

  // Demo has no older catalogue to migrate, so the cutover never runs here.
  // Every tier0 flow runs in demo, so leaving it on the retired detector would
  // point the E2E suite at code on its way out. Guarded separately: the
  // fixtures must land whether or not the config write does.
  try {
    applyDetectionStrictness('default');
  } catch (err) {
    if (__DEV__) console.warn('[seedDemoEngine] Failed to set the detector:', err);
  }

  try {
    // Deferred require, matching fetchDemoGps: the fixtures are ~400KB and a
    // live-mode session must never pay for them.
    const { fixtures, getWellness } =
      require('@/data/demo/fixtures') as typeof import('@/data/demo/fixtures');
    const curves =
      require('@/features/fitness/demo/curves') as typeof import('@/features/fitness/demo/curves');

    // Raw JSON, matching what the live write-through stores. The records model
    // fewer fields than the hooks read, so the body is the source of truth.
    engine.setAthleteProfile(JSON.stringify(fixtures.athlete));
    engine.setSportSettings(JSON.stringify(curves.demoSportSettings));

    const wellness = getWellness() as unknown as WellnessData[];
    if (wellness.length > 0) {
      engine.upsertWellness(
        wellness.map((w) => ({
          date: w.id,
          ctl: w.ctl ?? w.ctlLoad,
          atl: w.atl ?? w.atlLoad,
          rampRate: w.rampRate,
          hrv: w.hrv,
          restingHr: w.restingHR,
          weight: w.weight,
          sleepSecs: w.sleepSecs,
          sleepScore: w.sleepScore,
          soreness: w.soreness,
          fatigue: w.fatigue,
          stress: w.stress,
          mood: w.mood,
          motivation: w.motivation,
          // The wellness screens read the body, not the typed columns, so a
          // demo day without one would render as a gap.
          raw: JSON.stringify(w),
        }))
      );
    }

    const activities = fixtures.activities as unknown as Activity[];
    if (activities.length > 0) {
      engine.setActivityMetrics(activities.map(toActivityMetrics));
      // The feed reads bodies, not the typed metrics row, so a demo activity
      // without one would not appear at all.
      engine.upsertActivityBodies(
        activities.map((a) => ({
          activityId: a.id,
          date: Math.floor(new Date(a.start_date_local).getTime() / 1000),
          raw: JSON.stringify(a),
        }))
      );
      const oldest = activities.reduce(
        (min, a) => (a.start_date_local < min ? a.start_date_local : min),
        activities[0].start_date_local
      );
      engine.setSetting('oldest_activity_date', oldest);
    }

    seedActivityBodies(engine, activities);
    seedCurves(engine, curves);
    seedCalendarEvents(engine);

    const { criticalSpeed, dPrime, r2 } = curves.demoPaceCurve;
    if (criticalSpeed && criticalSpeed > 0) {
      engine.savePaceSnapshot(
        'Run',
        criticalSpeed,
        dPrime ?? undefined,
        r2 ?? undefined,
        todayTimestamp()
      );
    }

    engine.triggerRefresh('activities');
  } catch (err) {
    if (__DEV__) console.warn('[seedDemoEngine] Failed to seed demo fixtures:', err);
  }
}

/** Streams and intervals for every fixture activity, in the tables the charts
 *  read. Without these the detail screen would be blank in demo only. */
function seedActivityBodies(engine: DemoEngine, activities: Activity[]): void {
  const { getActivityIntervals } =
    require('@/data/demo/fixtures') as typeof import('@/data/demo/fixtures');

  // Streams are deliberately not seeded. The engine's stream store is a
  // bounded LRU far smaller than the fixture set, so seeding every activity
  // evicts all but the tail of the pass. `readStreams` answers demo misses
  // from the generator instead.
  for (const activity of activities) {
    const intervals = getActivityIntervals(activity.id);
    if (intervals) {
      engine.setIntervalBody(activity.id, JSON.stringify(intervals));
    }
  }
}

/** The power and pace curves the stats screens request, under the windows
 *  those screens ask for. */
function seedCurves(engine: DemoEngine, curves: DemoCurves): void {
  const power = JSON.stringify({
    list: [{ secs: curves.demoPowerCurve.secs, values: curves.demoPowerCurve.watts }],
  });
  const pace = JSON.stringify({
    list: [
      {
        distance: curves.demoPaceCurve.distances,
        values: curves.demoPaceCurve.times,
        paceModels: [
          {
            type: 'CS',
            criticalSpeed: curves.demoPaceCurve.criticalSpeed,
            dPrime: curves.demoPaceCurve.dPrime,
            r2: curves.demoPaceCurve.r2,
          },
        ],
      },
    ],
  });

  for (const days of POWER_CURVE_WINDOWS) {
    for (const sport of ['Ride', 'VirtualRide']) {
      engine.setCurveBody('power', sport, days, false, power);
    }
  }
  for (const days of PACE_CURVE_WINDOWS) {
    for (const sport of ['Run', 'Swim']) {
      engine.setCurveBody('pace', sport, days, false, pace);
      if (sport === 'Run') engine.setCurveBody('pace', sport, days, true, pace);
    }
  }
}

/** Planned workouts, over a window wide enough to cover the screens that
 *  read them (today, tomorrow, and the record screen's single day). */
function seedCalendarEvents(engine: DemoEngine): void {
  const { getDemoCalendarEvents } =
    require('@/data/demo/calendarEvents') as typeof import('@/data/demo/calendarEvents');

  const events = getDemoCalendarEvents();
  if (events.length === 0) return;

  const dates = events.map((e) => Math.floor(new Date(e.start_date_local).getTime() / 1000));
  engine.replaceCalendarEvents(
    Math.min(...dates) - 86400,
    Math.max(...dates) + 86400,
    events.map((e, i) => ({
      eventId: String(e.id),
      date: dates[i],
      raw: JSON.stringify(e),
    }))
  );
}
