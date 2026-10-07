/**
 * Extract the webhook payload from a background-notification task invocation.
 *
 * The shape varies by platform and expo-notifications version: iOS wraps the
 * push data as a JSON string under `data.dataString`, Android FCM data
 * messages arrive under `data.body`, and some paths deliver the data object
 * flat. The worker sends `{ event_type, athlete_id, activity_id }`.
 */

export type PushPayloadShape = 'dataString' | 'body' | 'flat' | 'nested' | 'none';

export interface PushEventPayload {
  eventType?: string | undefined;
  activityId?: string | undefined;
  athleteId?: string | undefined;
  /** Which shape matched, for diagnostics. */
  sourceShape: PushPayloadShape;
  /** Top-level key names of the raw task data, for diagnostics. No values. */
  rawKeys: string[];
}

interface WorkerPayload {
  event_type?: unknown;
  activity_id?: unknown;
  athlete_id?: unknown;
}

function readFields(obj: WorkerPayload): {
  eventType?: string | undefined;
  activityId?: string | undefined;
  athleteId?: string | undefined;
} | null {
  const eventType = typeof obj.event_type === 'string' ? obj.event_type : undefined;
  if (!eventType) return null;
  const activityId =
    typeof obj.activity_id === 'string' || typeof obj.activity_id === 'number'
      ? String(obj.activity_id)
      : undefined;
  const athleteId =
    typeof obj.athlete_id === 'string' || typeof obj.athlete_id === 'number'
      ? String(obj.athlete_id)
      : undefined;
  return { eventType, activityId, athleteId };
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The four wrappings a push data object can arrive in, in the order they are
 * tried. Shared so the tap path and the background task read one wire format
 * one way: two readings of it is what made a wrapped payload a dead tap
 *.
 */
function unwrappings(
  data: Record<string, unknown> | null
): { shape: PushPayloadShape; obj: Record<string, unknown> | null }[] {
  return [
    { shape: 'dataString', obj: parseJsonObject(data?.dataString) },
    { shape: 'body', obj: parseJsonObject(data?.body) },
    { shape: 'flat', obj: data },
    {
      shape: 'nested',
      obj:
        data?.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : null,
    },
  ];
}

export function extractPushPayload(taskData: unknown): PushEventPayload {
  const outer =
    taskData && typeof taskData === 'object' ? (taskData as Record<string, unknown>) : null;
  const rawKeys = outer ? Object.keys(outer) : [];
  const data =
    outer?.data && typeof outer.data === 'object' ? (outer.data as Record<string, unknown>) : null;

  for (const { shape, obj } of unwrappings(data)) {
    if (!obj) continue;
    const fields = readFields(obj as WorkerPayload);
    if (fields) {
      return { ...fields, sourceShape: shape, rawKeys };
    }
  }

  return { sourceShape: 'none', rawKeys };
}

/**
 * The athlete a notification was sent for, or undefined when it names none.
 *
 * The server's push carries `athlete_id` and the app stamps `athleteId` on
 * every entry it presents, so a tray entry left over from another library can
 * be told apart from one of the athlete signed in now.
 */
export function pushDataAthleteId(data: unknown): string | undefined {
  const outer = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  for (const { obj } of unwrappings(outer)) {
    if (!obj) continue;
    const athleteId = text(obj.athleteId) ?? text(obj.athlete_id);
    if (athleteId) return athleteId;
  }
  return undefined;
}

/** Where a tapped notification should land, and how to get there. */
export interface PushTapTarget {
  path: string;
  /**
   * `navigate` for a bare route, so one that targets a mounted tab switches to
   * it rather than stacking a duplicate tab screen on every tap. A specific
   * activity or section is a `push`.
   */
  mode: 'push' | 'navigate';
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined;

/**
 * Where a tap on this push should land, or null when the payload names
 * nowhere.
 *
 * Takes `content.data` from the notification response, which is the same
 * object `extractPushPayload` reaches through `taskData.data`, and unwraps it
 * the same four ways. Both the worker's camelCase tap fields and its snake_case
 * webhook fields are read, because the visible push carries both.
 */
export function tapTargetFromPushData(data: unknown): PushTapTarget | null {
  const outer = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;

  for (const { obj } of unwrappings(outer)) {
    if (!obj) continue;
    const activityId = text(obj.activityId) ?? text(obj.activity_id);
    if (activityId) return { path: `/activity/${activityId}`, mode: 'push' };
    const sectionId = text(obj.sectionId) ?? text(obj.section_id);
    if (sectionId) return { path: `/section/${sectionId}`, mode: 'push' };
    const route = text(obj.route);
    if (route) return { path: route, mode: 'navigate' };
  }

  return null;
}

/**
 * Whether an entry may open in the library signed in now: only when it names
 * that athlete. The tray can outlive the library it came from, when a wipe's
 * dismissal fails or a push lands before the previous athlete's token is
 * unregistered, and an entry that names nobody predates the stamp. Signed out,
 * nothing opens, whichever form the absence takes.
 */
export function isForSignedInAthlete(
  named: string | undefined,
  signedIn: string | null | undefined
): boolean {
  return !!signedIn && named === signedIn;
}

/**
 * The query parameter naming the athlete on the activity link the native
 * Android poster opens (`ActivityNotificationPoster.kt`).
 */
export const ACTIVITY_LINK_ATHLETE_PARAM = 'athlete';

function linkAthlete(query: string | undefined): string | undefined | null {
  let named: string | undefined | null = null;
  for (const pair of (query ?? '').split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key !== ACTIVITY_LINK_ATHLETE_PARAM) continue;
    try {
      named = decodeURIComponent(value.replace(/\+/g, ' ')) || undefined;
    } catch {
      named = undefined;
    }
  }
  return named;
}

/**
 * The deep link to open, or null to open the app where it is.
 *
 * The native Android entry opens its activity by link rather than through the
 * tap handler, so the link carries the athlete and passes the same check. An
 * activity link that names another athlete, or names none after the parameter
 * is present, opens nothing; one without the parameter is the app's or a
 * widget's own and passes. A link to the retired summary route is checked the
 * same way and sent to the activity. Every other link is returned as it came.
 */
export function openableSystemPath(
  path: string,
  signedIn: string | null | undefined
): string | null {
  const route = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  const link = /^(activity|summary)\/([^/?#]+)\/?(?:\?([^#]*))?(?:#.*)?$/.exec(route);
  if (!link) return path;
  const [, kind, id, query] = link;
  const named = linkAthlete(query);
  if (kind === 'summary') {
    return isForSignedInAthlete(named ?? undefined, signedIn) ? `/activity/${id}` : null;
  }
  if (named === null) return path;
  return isForSignedInAthlete(named, signedIn) ? path : null;
}
