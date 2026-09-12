import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { formatDurationDelta } from '@/shared/format/format';

import type { Insight, TFunc } from '../types';
import {
  type ActivityHighlight,
  type ActivityHighlightTier,
  type ActivityInfo,
  computeSectionPrDelta,
  resolveActivityHighlight,
} from './activityHighlight';

export { computeSectionPrDelta };
export type { ActivityInfo };

/**
 * Roughly what an Android lock screen shows of a body before it collapses the
 * line. iOS is more generous, around four lines, but truncates mid-word with
 * no ellipsis, so one cap serves both.
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
 * no name left to give and the lock screen dropped the delta. The
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
  // string available used to be the notification's own title.
  if (!activityName) return detail;
  const room = NOTIFICATION_BODY_MAX - detail.length - SEPARATOR.length;
  if (room < MIN_NAME_TAIL) return detail;
  return `${detail}${SEPARATOR}${trim(activityName, room)}`;
}

/**
 * Which rung of the ladder the body came from, and so which title goes with
 * it. Three is enough: the four PR rungs, the trend rung, and everything
 * below it, which is what the single hardcoded title used to cover.
 */
export type ActivityNotificationTier = ActivityHighlightTier;

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
 * The finding as a lock-screen clause, or null when the body is the activity
 * name alone.
 *
 * Every rung that carries a place name goes through `fitDetail`, which is the
 * cap's only concession: the delta is what the enrichment exists for, so the
 * name yields to it rather than the other way round.
 */
export function formatHighlightDetail(
  highlight: ActivityHighlight,
  t: TFunc,
  info: ActivityInfo | null
): string | null {
  return renderHighlight(highlight, t, info, fitDetail);
}

/**
 * The same finding with nothing given up: the full place name and no cap.
 *
 * A screen has room the lock screen does not, and it must say the same thing:
 * one set of templates, two fits, so the sentence the athlete was shown and
 * the one on the screen cannot drift apart.
 */
export function formatHighlightSentence(
  highlight: ActivityHighlight,
  t: TFunc,
  info: ActivityInfo | null
): string | null {
  return renderHighlight(highlight, t, info, (render, name) => render(name));
}

type Fit = (render: (place: string) => string, rawName: string) => string;

function renderHighlight(
  highlight: ActivityHighlight,
  t: TFunc,
  info: ActivityInfo | null,
  fit: Fit
): string | null {
  switch (highlight.kind) {
    case 'routePr':
      return fit(
        (place) =>
          highlight.improvementSeconds
            ? t('notifications.activityBody.routePrDelta', {
                name: place,
                delta: formatDurationDelta(highlight.improvementSeconds),
              })
            : t('notifications.activityBody.routePr', { name: place }),
        highlight.routeName
      );
    case 'sectionPr':
      return fit(
        (place) =>
          highlight.improvementSeconds
            ? t('notifications.activityBody.sectionPrDelta', {
                name: place,
                delta: formatDurationDelta(highlight.improvementSeconds),
              })
            : t('notifications.activityBody.sectionPr', { name: place }),
        sectionPlace(highlight.sectionName, highlight.named, t)
      );
    case 'sectionPrMany':
      return highlight.named
        ? fit(
            (place) =>
              t('notifications.activityBody.sectionPrMany', {
                name: place,
                count: highlight.count - 1,
              }),
            highlight.sectionName
          )
        : t('notifications.activityBody.sectionPrCount', { count: highlight.count });
    case 'routePrUnnamed':
      return highlight.improvementSeconds
        ? t('notifications.activityBody.routePrUnnamedDelta', {
            delta: formatDurationDelta(highlight.improvementSeconds),
          })
        : t('notifications.activityBody.routePrUnnamed');
    case 'fasterOnRoute':
      return fit(
        (place) =>
          highlight.gapSeconds != null
            ? t('notifications.activityBody.fasterOnRouteDelta', {
                name: place,
                delta: formatDurationDelta(highlight.gapSeconds),
              })
            : t('notifications.activityBody.fasterOnRoute', { name: place }),
        highlight.routeName
      );
    case 'onRoute':
      return fit(
        (place) => t('notifications.activityBody.onRoute', { name: place }),
        highlight.routeName
      );
    case 'milestone':
      return highlight.title;
    case 'none':
    default:
      return null;
  }
}

/** An unnamed section reads as "a section" rather than as an empty name. */
function sectionPlace(name: string, named: boolean, t: TFunc): string {
  return named ? name : t('notifications.activityBody.aSection');
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
  const { highlight, tier } = resolveActivityHighlight(
    activityId,
    newInsights,
    prefs.categories.sectionPr,
    activityInfo,
    prefs.categories.fitnessMilestone
  );
  const detail = formatHighlightDetail(highlight, t, activityInfo);
  // The cap binds on what is posted, not on the name alone. A clause with no
  // name left to give up is cut here rather than by the lock screen.
  const clause = detail === null ? null : trim(detail, NOTIFICATION_BODY_MAX);
  return {
    title: t(TITLE_KEYS[tier]),
    // No clause, no notification. The ladder found no PR, no named-route
    // result and no milestone, and the activity's own name is not news. An
    // empty body is how that reaches the tray decision, which takes the
    // generic entry down rather than reposting the ride back at the athlete.
    body: clause === null ? '' : compose(clause, activityName),
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
