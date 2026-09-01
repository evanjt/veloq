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
  eventType?: string;
  activityId?: string;
  /** Which shape matched, for diagnostics. */
  sourceShape: PushPayloadShape;
  /** Top-level key names of the raw task data, for diagnostics. No values. */
  rawKeys: string[];
}

interface WorkerPayload {
  event_type?: unknown;
  activity_id?: unknown;
}

function readFields(obj: WorkerPayload): { eventType?: string; activityId?: string } | null {
  const eventType = typeof obj.event_type === 'string' ? obj.event_type : undefined;
  if (!eventType) return null;
  const activityId =
    typeof obj.activity_id === 'string' || typeof obj.activity_id === 'number'
      ? String(obj.activity_id)
      : undefined;
  return { eventType, activityId };
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
 * (`B144`).
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
