// The edits the routes, sections and activity panes offer. One table names the
// write method and params of each, so a pane never builds a call by hand. The
// engine decides whether an edit is allowed; this carries its refusal text.

import type { ParseKeys } from 'i18next';

import { type Matcher, type Optimistic, type WriteOptions } from './query';
import type { Methods } from './schema';

export type Edit =
  | { kind: 'renameSection'; id: string; name: string; was: string }
  | { kind: 'setLift'; id: string; isLift: boolean }
  | { kind: 'accept'; id: string }
  | { kind: 'setEnabled'; id: string; enabled: boolean }
  | { kind: 'sectionPass'; id: string; activityId: string; excluded: boolean }
  | { kind: 'renameRoute'; id: string; name: string; was: string }
  | { kind: 'routePass'; id: string; activityId: string; excluded: boolean }
  | { kind: 'setReference'; id: string; activityId: string }
  | { kind: 'resetReference'; id: string }
  | { kind: 'heatmap'; activityId: string; hidden: boolean };

export type Call = { method: keyof Methods; params: object };

/** The write method and params an edit is sent as. */
export function callOf(edit: Edit): Call {
  switch (edit.kind) {
    case 'renameSection':
      return { method: 'section.rename', params: { id: edit.id, name: edit.name } };
    case 'setLift':
      return { method: 'section.setLift', params: { id: edit.id, isLift: edit.isLift } };
    case 'accept':
      return { method: 'section.accept', params: { id: edit.id } };
    case 'setEnabled':
      return {
        method: edit.enabled ? 'section.enable' : 'section.disable',
        params: { id: edit.id },
      };
    case 'sectionPass':
      return {
        method: edit.excluded ? 'section.excludeActivity' : 'section.includeActivity',
        params: { id: edit.id, activityId: edit.activityId },
      };
    case 'renameRoute':
      return { method: 'route.rename', params: { id: edit.id, name: edit.name } };
    case 'routePass':
      return {
        method: edit.excluded ? 'route.excludeActivity' : 'route.includeActivity',
        params: { id: edit.id, activityId: edit.activityId },
      };
    case 'setReference':
      return {
        method: 'route.setReference',
        params: { id: edit.id, activityId: edit.activityId },
      };
    case 'resetReference':
      return { method: 'route.resetReference', params: { id: edit.id } };
    case 'heatmap':
    default:
      return {
        method: 'heatmap.setHidden',
        params: { activityId: edit.activityId, hidden: edit.hidden },
      };
  }
}

/** The reads that carry a route: its list row, detail, attempts, lines, and the activities and insights that name it. */
const ROUTE_READS = [
  'routes.screen',
  'route.detail',
  'route.performance',
  'route.attempts',
  'geo.routeLines',
  'geo.route',
  'geo.routeLatest',
  'activity.detail',
  'insights.data',
] as const;

/** The reads that carry a section: its list row, detail, history, lines, and the activities and insights that name it. */
const SECTION_READS = [
  'routes.screen',
  'section.detail',
  'section.performance',
  'section.history',
  'section.excluded',
  'sections.retired',
  'geo.sections',
  'geo.section',
  'geo.sectionPasses',
  'geo.sectionVersion',
  'activity.detail',
  'activity.sections',
  'insights.data',
  'insights.workoutSections',
] as const;

/**
 * The reads an edit changes. The heatmap switch changes one activity's detail;
 * a route edit changes the route reads, and a section edit the section reads.
 * No other screen's read is asked again.
 */
export function invalidatesOf(edit: Edit): Matcher {
  switch (edit.kind) {
    case 'heatmap':
      return ['activity.detail'];
    case 'renameRoute':
    case 'routePass':
      return ROUTE_READS;
    default:
      return SECTION_READS;
  }
}

type SectionDetail = Methods['section.detail']['result'];
type RouteDetail = Methods['route.detail']['result'];

/** An excluded pass is listed as excluded, and an included one is not. */
function passesWith(listed: readonly string[], activityId: string, excluded: boolean): string[] {
  const rest = listed.filter((id) => id !== activityId);
  return excluded ? [...rest, activityId] : rest;
}

/**
 * The detail reads an edit shows at once while the phone answers: a rename
 * changes the name, an excluded pass leaves the rows and joins the excluded
 * list, an included one leaves the excluded list. The rows an included pass
 * would return are not held, so they show once the detail is read again.
 */
export function optimisticOf(edit: Edit): Optimistic[] {
  switch (edit.kind) {
    case 'renameSection':
      return [
        {
          method: 'section.detail',
          args: { id: edit.id },
          update: (held: SectionDetail) => ({
            ...held,
            section: { ...held.section, name: edit.name },
          }),
        },
      ];
    case 'sectionPass':
      return [
        {
          method: 'section.detail',
          args: { id: edit.id },
          update: (held: SectionDetail) => ({
            ...held,
            activityRows: edit.excluded
              ? held.activityRows.filter((row) => row.activityId !== edit.activityId)
              : held.activityRows,
            excludedActivityIds: passesWith(
              held.excludedActivityIds,
              edit.activityId,
              edit.excluded
            ),
          }),
        },
      ];
    case 'renameRoute':
      return [
        {
          method: 'route.detail',
          args: { id: edit.id },
          update: (held: RouteDetail) => ({
            ...held,
            group: { ...held.group, customName: edit.name },
          }),
        },
      ];
    case 'routePass':
      return [
        {
          method: 'route.detail',
          args: { id: edit.id },
          update: (held: RouteDetail) => ({
            ...held,
            excludedActivityIds: passesWith(
              held.excludedActivityIds,
              edit.activityId,
              edit.excluded
            ),
          }),
        },
      ];
    default:
      return [];
  }
}

/**
 * The notice an answered edit shows and the edit that puts back what it
 * changed. Null for an edit nothing reverts, such as accepting a section.
 */
export function undoOf(edit: Edit): { notice: ParseKeys; reverse: Edit } | null {
  switch (edit.kind) {
    case 'renameSection':
      return {
        notice: 'connectPage.undo.renamed',
        reverse: { ...edit, name: edit.was, was: edit.name },
      };
    case 'renameRoute':
      return {
        notice: 'connectPage.undo.renamed',
        reverse: { ...edit, name: edit.was, was: edit.name },
      };
    case 'sectionPass':
      return {
        notice: edit.excluded ? 'connectPage.undo.excluded' : 'connectPage.undo.included',
        reverse: { ...edit, excluded: !edit.excluded },
      };
    case 'routePass':
      return {
        notice: edit.excluded ? 'connectPage.undo.excluded' : 'connectPage.undo.included',
        reverse: { ...edit, excluded: !edit.excluded },
      };
    case 'heatmap':
      return {
        notice: edit.hidden ? 'connectPage.undo.hidden' : 'connectPage.undo.shown',
        reverse: { ...edit, hidden: !edit.hidden },
      };
    default:
      return null;
  }
}

export type Outcome = { ok: true } | { ok: false; refusal: string };

type Write = (method: never, params: never, options?: WriteOptions) => Promise<{ ok: boolean }>;

/**
 * Send an edit. The write names the reads it changes, so the reads that show
 * it are asked again when the phone answers, and shows the detail it changes
 * at once. An edit that can be reversed carries its notice and the undo. A
 * refusal returns the engine's text, which is empty when it gave none.
 */
export async function applyEdit(write: Write, edit: Edit): Promise<Outcome> {
  const { method, params } = callOf(edit);
  const undo = undoOf(edit);
  const optimistic = optimisticOf(edit);
  try {
    const done = await write(method as never, params as never, {
      invalidates: invalidatesOf(edit),
      ...(optimistic.length > 0 ? { optimistic } : {}),
      ...(undo ? { notice: undo.notice, undo: () => callOf(undo.reverse) } : {}),
    });
    if (!done.ok) return { ok: false, refusal: '' };
  } catch (error) {
    return { ok: false, refusal: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}
