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
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { Activity, WellnessData } from '@/types';

/** Midnight today, in the epoch seconds the pace snapshot table keys on. */
function todayTimestamp(): number {
  return Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
}

export function seedDemoEngine(): void {
  const engine = getRouteEngine();
  if (!engine) return;

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
        }))
      );
    }

    const activities = fixtures.activities as unknown as Activity[];
    if (activities.length > 0) {
      engine.setActivityMetrics(activities.map(toActivityMetrics));
    }

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
