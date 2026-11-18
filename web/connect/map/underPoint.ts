// What a click on the heatmap lists: the engine's own answer to "what passes under this point",
// shaped into the rows the selection panel draws. Which activities are under the point is the
// engine's decision alone; nothing here tests a position.

import type { Methods } from '../schema';

export type UnderPointAnswer = Methods['heatmap.underPoint']['result'];
export type UnderPointGroup = UnderPointAnswer['groups'][number];
export type UnderPointActivity = UnderPointGroup['activities'][number];

/** The shallowest and the deepest zoom the heatmap is drawn at, and so asked at. */
const MIN_ASK_ZOOM = 1;
const MAX_ASK_ZOOM = 17;

/** The ask for a click at `at` (longitude, latitude) with the camera at `zoom`. */
export function underPointAsk(
  at: [number, number],
  zoom: number
): Methods['heatmap.underPoint']['params'] {
  return {
    latitude: at[1],
    longitude: at[0],
    zoom: Math.min(MAX_ASK_ZOOM, Math.max(MIN_ASK_ZOOM, Math.floor(zoom))),
  };
}

export type UnderPointKind = 'all' | 'routes' | 'sections' | 'activities';

/** Every activity the engine listed, each once, newest first. */
export function activityRows(answer: UnderPointAnswer): UnderPointActivity[] {
  return answer.activities;
}

const isRoute = (group: UnderPointGroup) => group.kind === 'route';
const isSection = (group: UnderPointGroup) => group.kind === 'section';

/** The groups a kind lists: routes and sections as groups, the others none. */
export function groupRows(answer: UnderPointAnswer, kind: UnderPointKind): UnderPointGroup[] {
  if (kind === 'routes') return answer.groups.filter(isRoute);
  if (kind === 'sections') return answer.groups.filter(isSection);
  if (kind === 'activities') return [];
  return answer.groups.filter((group) => group.kind !== 'noRoute');
}

/**
 * The segments of the kind filter, each with its count: only the kinds present, and none when
 * the answer holds one kind of group, since there is nothing to narrow.
 */
export function kindOptions(answer: UnderPointAnswer): { kind: UnderPointKind; count: number }[] {
  const routes = answer.groups.filter(isRoute).length;
  const sections = answer.groups.filter(isSection).length;
  const loose = answer.groups.some((group) => group.kind === 'noRoute');
  if ([routes > 0, sections > 0, loose].filter(Boolean).length < 2) return [];
  return [
    { kind: 'all' as const, count: answer.activities.length },
    ...(routes > 0 ? [{ kind: 'routes' as const, count: routes }] : []),
    ...(sections > 0 ? [{ kind: 'sections' as const, count: sections }] : []),
    { kind: 'activities' as const, count: answer.activities.length },
  ];
}
