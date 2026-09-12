/**
 * What one activity was worth, as a value rather than as a sentence.
 *
 * The priority ladder below is the most compact statement the app can make
 * about an activity: a route PR, then a section PR, then a multi-section PR,
 * then an unnamed route PR, then faster than usual, then on a known route,
 * then a traversal count, then a fitness milestone, then distance and time.
 *
 * It used to live inside the notification builder, which meant it was also the
 * only place that knew it, and the athlete could not check on any screen what
 * the notification had claimed. The finding is here and the rendering is the
 * caller's: the lock screen caps it at sixty characters and gives the name
 * back until the clause fits, the summary screen shows it whole. Two renderers
 * over one resolver is what stops the sentence and the screen disagreeing.
 */

import type { Insight } from '../types';

export interface ActivityInfo {
  name: string;
  type: string;
  ingested: boolean;
  distance?: number;
  movingTime?: number;
}

/**
 * Which rung the finding came from, and so which title goes with it. Three is
 * enough: the four PR rungs, the trend rung, and everything below it.
 */
export type ActivityHighlightTier = 'pr' | 'faster' | 'recorded';

/**
 * One rung's finding. Every seconds field is a real comparison or null: a
 * claim the engine could not support is absent rather than zero.
 */
export type ActivityHighlight =
  /** A personal best over a matched route the athlete has named. */
  | { kind: 'routePr'; routeName: string; improvementSeconds: number | null }
  /** A personal best over one section. `named` is false for an unnamed one. */
  | {
      kind: 'sectionPr';
      sectionName: string;
      named: boolean;
      improvementSeconds: number | null;
    }
  /** Personal bests over several sections at once. */
  | { kind: 'sectionPrMany'; sectionName: string; named: boolean; count: number }
  /** A personal best over a route with no name to show. */
  | { kind: 'routePrUnnamed'; improvementSeconds: number | null }
  /**
   * Faster than the running average of prior traversals. `gapSeconds` is the
   * gap still to close on the all-time best, never an improvement on it.
   */
  | { kind: 'fasterOnRoute'; routeName: string; gapSeconds: number | null }
  /** A known route, no verdict on the time. */
  | { kind: 'onRoute'; routeName: string }
  /** A fitness milestone this activity caused, carrying its own wording. */
  | { kind: 'milestone'; title: string }
  /** Nothing worth a push, so there is no notification. */
  | { kind: 'none' };

export interface ResolvedActivityHighlight {
  highlight: ActivityHighlight;
  tier: ActivityHighlightTier;
}

interface PerfRecord {
  activityId: string;
  bestTime: number;
  direction: string;
}

export interface PerfResult {
  records?: PerfRecord[];
  bestRecord?: PerfRecord | null;
}

/**
 * Seconds this activity's section PR improved on the previous best, from the
 * records already returned by `getPerformancesBatch`. Null when this is the
 * only timed attempt in the PR's direction, or times tie.
 */
export function computeSectionPrDelta(
  result: PerfResult | undefined,
  activityId: string
): number | null {
  const best = result?.bestRecord;
  if (!best || best.activityId !== activityId) return null;
  if (!Number.isFinite(best.bestTime) || best.bestTime <= 0) return null;
  const others = (result.records ?? []).filter(
    (r) =>
      r.activityId !== activityId &&
      r.direction === best.direction &&
      Number.isFinite(r.bestTime) &&
      r.bestTime > 0
  );
  if (others.length === 0) return null;
  const previousBest = Math.min(...others.map((r) => r.bestTime));
  const delta = previousBest - best.bestTime;
  return delta > 0 ? delta : null;
}

interface RouteHighlight {
  routeName: string;
  isPr: boolean;
  trendUp: boolean;
  timeDeltaSeconds: number | null;
  prImprovementSeconds: number | null;
}

/**
 * Matched-route signal for this activity, from the same engine data that
 * drives the activity-card route badge. Best-effort: returns null when the
 * activity is not (yet) in any route group.
 */
function getRouteHighlight(activityId: string): RouteHighlight | null {
  try {
    const { engine } = require('veloqrs');
    type Highlight = {
      activityId: string;
      routeName: string;
      isPr: boolean;
      trend: number;
      timeDeltaSeconds?: number | null;
      prImprovementSeconds?: number | null;
    };
    const highlights: Highlight[] = engine.getActivityRouteHighlights([activityId]);
    const h = highlights?.find((entry) => entry.activityId === activityId);
    if (!h) return null;
    return {
      routeName: h.routeName ?? '',
      isPr: !!h.isPr,
      trendUp: h.trend > 0,
      timeDeltaSeconds: typeof h.timeDeltaSeconds === 'number' ? h.timeDeltaSeconds : null,
      prImprovementSeconds:
        typeof h.prImprovementSeconds === 'number' && h.prImprovementSeconds > 0
          ? h.prImprovementSeconds
          : null,
    };
  } catch {
    return null;
  }
}

const pr = (highlight: ActivityHighlight): ResolvedActivityHighlight => ({ highlight, tier: 'pr' });
const faster = (highlight: ActivityHighlight): ResolvedActivityHighlight => ({
  highlight,
  tier: 'faster',
});
const recorded = (highlight: ActivityHighlight): ResolvedActivityHighlight => ({
  highlight,
  tier: 'recorded',
});

/**
 * Walk the priority ladder for this activity.
 *
 * Queries the engine for the matched route, the section PRs and the matches
 * for this specific activity, rather than relying on generic insight
 * fingerprint diffing.
 */
export function resolveActivityHighlight(
  activityId: string,
  newInsights: Insight[],
  /**
   * Whether the athlete wants to hear about personal bests. Only the four PR
   * rungs are gated on it, so the resolver takes the flags rather than the
   * whole preferences store, which no screen should have to hold to ask what
   * an activity was worth.
   */
  announcePrs: boolean,
  activityInfo: ActivityInfo | null,
  /** Whether the athlete wants to hear about fitness milestones. */
  announceMilestones = true
): ResolvedActivityHighlight {
  const route = getRouteHighlight(activityId);

  try {
    const { engine } = require('veloqrs');

    // Rust already filters out disabled and superseded sections.
    const sections = engine.getSectionsForActivity(activityId);
    const sectionCount = sections?.length ?? 0;

    let prCount = 0;
    let prSectionName = '';
    let prSectionHasName = false;
    let prSectionDelta: number | null = null;
    if (sectionCount > 0) {
      // One batched call rather than one per section, which saves (N-1) FFI
      // round trips in the background task.
      const sectionIds = sections.map((s: { id: string }) => s.id);
      type BatchEntry = { sectionId: string; result: PerfResult };
      const batch: BatchEntry[] = (() => {
        try {
          return engine.getPerformancesBatch(sectionIds);
        } catch {
          return [];
        }
      })();
      const perfById = new Map(batch.map((entry: BatchEntry) => [entry.sectionId, entry.result]));

      for (const section of sections) {
        const perf = perfById.get(section.id);
        if (perf?.bestRecord?.activityId === activityId) {
          prCount++;
          if (!prSectionName) {
            prSectionHasName = !!section.name;
            prSectionName = section.name;
            prSectionDelta = computeSectionPrDelta(perf, activityId);
          }
        }
      }
    }

    // Achievements first, gated by the PR category preference, then the
    // matched-route identity, then plain traversal counts.
    if (announcePrs) {
      if (route?.isPr && route.routeName) {
        return pr({
          kind: 'routePr',
          routeName: route.routeName,
          improvementSeconds: route.prImprovementSeconds,
        });
      }
      if (prCount === 1) {
        return pr({
          kind: 'sectionPr',
          sectionName: prSectionName,
          named: prSectionHasName,
          improvementSeconds: prSectionDelta,
        });
      }
      if (prCount > 1) {
        return pr({
          kind: 'sectionPrMany',
          sectionName: prSectionName,
          named: prSectionHasName,
          count: prCount,
        });
      }
      if (route?.isPr) {
        return pr({ kind: 'routePrUnnamed', improvementSeconds: route.prImprovementSeconds });
      }
    }

    if (route?.trendUp && route.routeName) {
      return faster({
        kind: 'fasterOnRoute',
        routeName: route.routeName,
        gapSeconds:
          route.timeDeltaSeconds != null && route.timeDeltaSeconds > 0
            ? route.timeDeltaSeconds
            : null,
      });
    }
    if (route?.routeName) {
      return recorded({ kind: 'onRoute', routeName: route.routeName });
    }
    // Riding through a section is not a result. Only notable rides notify, so
    // this stops here rather than announcing that the ride happened.
  } catch {
    // The engine could not answer, so the rungs below it are all that is left.
  }

  const milestone = announceMilestones
    ? newInsights.find((i) => i.category === 'fitness_milestone')
    : undefined;
  if (milestone) {
    return recorded({ kind: 'milestone', title: milestone.title });
  }

  // No floor rung. A distance-and-time line tells the athlete what they
  // already know they did, and it fired on every activity, so an athlete who
  // commutes five days a week got five pushes worth nothing.
  return recorded({ kind: 'none' });
}
