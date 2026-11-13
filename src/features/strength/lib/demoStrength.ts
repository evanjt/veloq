import { fixtures } from '@/shared/demo/activity/activities';

/**
 * The demo library's strength sessions. The engine holds their exercise sets
 * (`src/strength/demo.rs`) and settles a session when the app asks for its FIT
 * file, so the app only names the sessions it holds.
 */
const DEMO_STRENGTH_IDS: ReadonlySet<string> = new Set(
  fixtures.activities.filter((a) => a.type === 'WeightTraining').map((a) => a.id)
);

export function isDemoStrengthActivity(activityId: string): boolean {
  return DEMO_STRENGTH_IDS.has(activityId);
}

export function demoStrengthActivityIds(): readonly string[] {
  return [...DEMO_STRENGTH_IDS];
}
