import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { formatDurationDelta } from '@/shared/format/format';

import type { Insight, TFunc } from '../types';

export interface ActivityInfo {
  name: string;
  type: string;
  ingested: boolean;
  distance?: number;
  movingTime?: number;
}

export function formatBasicStat(info: ActivityInfo | null, t: TFunc): string | null {
  if (!info) return null;
  const km = info.distance && info.distance > 0 ? info.distance / 1000 : 0;
  const mins = info.movingTime && info.movingTime > 0 ? Math.round(info.movingTime / 60) : 0;
  if (km >= 1 && mins > 0) {
    return t('notifications.activityBody.distanceAndTime', { km: km.toFixed(1), min: mins });
  }
  if (km >= 1) {
    return t('notifications.activityBody.distanceOnly', { km: km.toFixed(1) });
  }
  if (mins > 0) {
    return t('notifications.activityBody.timeOnly', { min: mins });
  }
  return null;
}

interface PerfRecord {
  activityId: string;
  bestTime: number;
  direction: string;
}

interface PerfResult {
  records?: PerfRecord[];
  bestRecord?: PerfRecord | null;
}

/**
 * Seconds this activity's section PR improved on the previous best, from the
 * records already returned by getPerformancesBatch. Null when this is the
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

/**
 * Matched-route signal for this activity, from the same engine data that
 * drives the activity-card route badge. Best-effort: returns null when the
 * activity is not (yet) in any route group.
 */
function getRouteHighlight(activityId: string): {
  routeName: string;
  isPr: boolean;
  trendUp: boolean;
  timeDeltaSeconds: number | null;
  prImprovementSeconds: number | null;
} | null {
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

/**
 * Roughly what an Android lock screen shows of a body before it collapses the
 * line. iOS is more generous, around four lines, but truncates mid-word with
 * no ellipsis, so one cap serves both (`B148`).
 */
export const NOTIFICATION_BODY_MAX = 60;

/** A route or section name inside a detail clause. */
const MAX_PLACE_NAME = 24;

/**
 * Below this there is no room for a name, only for a fragment of one, so the
 * activity name is dropped instead.
 */
const MIN_NAME_TAIL = 8;

const SEPARATOR = ' - ';

/** A route or section name as it appears inside a detail clause. */
const placeName = (name: string): string => trim(name, MAX_PLACE_NAME);

/**
 * Below this a place name is a fragment rather than a name, so the template
 * gets what is left and the cap does the rest.
 */
const MIN_PLACE_NAME = 6;

/**
 * A detail clause that fits, by giving the place name back to the template
 * until it does.
 *
 * `MAX_PLACE_NAME` was sized against the English templates, and a translated
 * one is longer: "Faster than usual on X (2:34 off PR)" is 56 characters in
 * English and 72 in Portuguese, so the clause cleared the cap on its own with
 * no name left to give and the lock screen dropped the delta (`B153`). The
 * delta is the finding, so the name yields to it, and the clause is only cut
 * outright when there is no name left to take.
 */
function fitDetail(render: (place: string) => string, rawName: string): string {
  let cap = MAX_PLACE_NAME;
  let out = render(trim(rawName, cap));
  while (out.length > NOTIFICATION_BODY_MAX && cap > MIN_PLACE_NAME) {
    cap = Math.max(MIN_PLACE_NAME, cap - (out.length - NOTIFICATION_BODY_MAX));
    out = render(trim(rawName, cap));
  }
  return out;
}

/** Trim to `max`, marking the cut, so a name never runs off the end silently. */
function trim(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}\u2026`;
}

/**
 * The finding first, the activity name second.
 *
 * The name used to lead, so a long one plus a user-renamed route pushed the PR
 * and its delta past the collapse, and the athlete saw only what they had just
 * uploaded. The detail is never truncated: it is the only reason the
 * enrichment pipeline exists. The name gives way, and is dropped outright when
 * what is left of it would be a fragment.
 */
function compose(detail: string, activityName: string): string {
  // No name means no activity to describe: the ingest failed and the only
  // string available used to be the notification's own title (`B149`).
  if (!activityName) return detail;
  const room = NOTIFICATION_BODY_MAX - detail.length - SEPARATOR.length;
  if (room < MIN_NAME_TAIL) return detail;
  return `${detail}${SEPARATOR}${trim(activityName, room)}`;
}

/**
 * Which rung of the ladder the body came from, and so which title goes with
 * it. Three is enough: the four PR rungs, the trend rung, and everything
 * below it, which is what the single hardcoded title used to cover (`B150`).
 */
export type ActivityNotificationTier = 'pr' | 'faster' | 'recorded';

const TITLE_KEYS: Record<ActivityNotificationTier, string> = {
  pr: 'notifications.activityPr.title',
  faster: 'notifications.activityFaster.title',
  recorded: 'notifications.activityRecorded.title',
};

export interface ActivityNotification {
  title: string;
  body: string;
}

/**
 * The detail clause and the rung it came from. A null detail means no clause
 * won and the body is the activity name alone.
 */
interface Detail {
  detail: string | null;
  tier: ActivityNotificationTier;
}

const pr = (detail: string): Detail => ({ detail, tier: 'pr' });
const faster = (detail: string): Detail => ({ detail, tier: 'faster' });
const recorded = (detail: string | null): Detail => ({ detail, tier: 'recorded' });

/**
 * Walk the priority ladder for this activity.
 * Queries the engine to find the matched route, section PRs, and matches for
 * THIS specific activity, rather than relying on generic insight fingerprint
 * diffing.
 */
function resolveDetail(
  activityId: string,
  newInsights: Insight[],
  prefs: NotificationPreferences,
  activityInfo: ActivityInfo | null,
  t: TFunc
): Detail {
  const route = getRouteHighlight(activityId);

  try {
    const { engine } = require('veloqrs');

    // Check which sections this activity traversed
    // Rust already filters out disabled/superseded sections
    const sections = engine.getSectionsForActivity(activityId);
    const sectionCount = sections?.length ?? 0;

    let prCount = 0;
    let prSectionName = '';
    let prSectionHasName = false;
    let prSectionDelta: number | null = null;
    if (sectionCount > 0) {
      // Single batched FFI call instead of one per section. Saves
      // (N-1) × ~10-30 ms of round-trip overhead in the background task.
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
            prSectionName = section.name || t('notifications.activityBody.aSection');
            prSectionDelta = computeSectionPrDelta(perf, activityId);
          }
        }
      }
    }

    // Achievements first (gated by the PR category preference), then the
    // matched-route identity, then plain traversal counts. Each delta key
    // falls back to its no-delta sibling when the comparison isn't available.
    if (prefs.categories.sectionPr) {
      if (route?.isPr && route.routeName) {
        const improvement = route.prImprovementSeconds;
        return pr(
          fitDetail(
            (place) =>
              improvement
                ? t('notifications.activityBody.routePrDelta', {
                    name: place,
                    delta: formatDurationDelta(improvement),
                  })
                : t('notifications.activityBody.routePr', { name: place }),
            route.routeName
          )
        );
      }
      if (prCount === 1) {
        const delta = prSectionDelta;
        return pr(
          fitDetail(
            (place) =>
              delta
                ? t('notifications.activityBody.sectionPrDelta', {
                    name: place,
                    delta: formatDurationDelta(delta),
                  })
                : t('notifications.activityBody.sectionPr', { name: place }),
            prSectionName
          )
        );
      }
      if (prCount > 1) {
        return pr(
          prSectionHasName
            ? fitDetail(
                (place) =>
                  t('notifications.activityBody.sectionPrMany', {
                    name: place,
                    count: prCount - 1,
                  }),
                prSectionName
              )
            : t('notifications.activityBody.sectionPrCount', { count: prCount })
        );
      }
      if (route?.isPr) {
        return pr(
          route.prImprovementSeconds
            ? t('notifications.activityBody.routePrUnnamedDelta', {
                delta: formatDurationDelta(route.prImprovementSeconds),
              })
            : t('notifications.activityBody.routePrUnnamed')
        );
      }
    }

    // A speed verdict against a running average, not a time against the
    // all-time best, so neither this clause nor its title may claim a time
    // improvement. The delta here is the gap still to close.
    if (route?.trendUp && route.routeName) {
      const gap = route.timeDeltaSeconds;
      return faster(
        fitDetail(
          (place) =>
            gap != null && gap > 0
              ? t('notifications.activityBody.fasterOnRouteDelta', {
                  name: place,
                  delta: formatDurationDelta(gap),
                })
              : t('notifications.activityBody.fasterOnRoute', { name: place }),
          route.routeName
        )
      );
    }
    if (route?.routeName) {
      return recorded(
        fitDetail(
          (place) => t('notifications.activityBody.onRoute', { name: place }),
          route.routeName
        )
      );
    }
    if (sectionCount === 1) {
      return recorded(t('notifications.activityBody.sectionTraversedOne'));
    }
    if (sectionCount > 1) {
      return recorded(
        t('notifications.activityBody.sectionTraversedMany', { count: sectionCount })
      );
    }
  } catch {
    // Engine query failed, fall through
  }

  // Check for new insights caused by this activity
  const milestone = newInsights.find((i) => i.category === 'fitness_milestone');
  if (milestone) {
    return recorded(milestone.title);
  }

  // Fallback: basic stats so the notification isn't just the activity name
  return recorded(formatBasicStat(activityInfo, t));
}

/**
 * Build the enriched activity notification, title and body together. The rung
 * that wins the body picks the title, so the one line an Android lock screen
 * reliably shows says which kind of outcome this was.
 */
export function buildActivityNotification(
  activityId: string,
  activityName: string,
  newInsights: Insight[],
  prefs: NotificationPreferences,
  activityInfo: ActivityInfo | null,
  t: TFunc
): ActivityNotification {
  const { detail, tier } = resolveDetail(activityId, newInsights, prefs, activityInfo, t);
  // The cap binds on what is posted, not on the name alone. A clause with no
  // name left to give up is cut here rather than by the lock screen.
  const clause = detail === null ? null : trim(detail, NOTIFICATION_BODY_MAX);
  return {
    title: t(TITLE_KEYS[tier]),
    body:
      clause === null ? trim(activityName, NOTIFICATION_BODY_MAX) : compose(clause, activityName),
  };
}

/** The body alone, for callers that only decide what the tray does with it. */
export function buildActivityNotificationBody(
  activityId: string,
  activityName: string,
  newInsights: Insight[],
  prefs: NotificationPreferences,
  activityInfo: ActivityInfo | null,
  t: TFunc
): string {
  return buildActivityNotification(activityId, activityName, newInsights, prefs, activityInfo, t)
    .body;
}
