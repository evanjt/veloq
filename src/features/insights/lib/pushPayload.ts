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

function parseJsonObject(raw: unknown): WorkerPayload | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as WorkerPayload) : null;
  } catch {
    return null;
  }
}

export function extractPushPayload(taskData: unknown): PushEventPayload {
  const outer =
    taskData && typeof taskData === 'object' ? (taskData as Record<string, unknown>) : null;
  const rawKeys = outer ? Object.keys(outer) : [];
  const data =
    outer?.data && typeof outer.data === 'object' ? (outer.data as Record<string, unknown>) : null;

  const candidates: Array<{ shape: PushPayloadShape; obj: WorkerPayload | null }> = [
    { shape: 'dataString', obj: parseJsonObject(data?.dataString) },
    { shape: 'body', obj: parseJsonObject(data?.body) },
    { shape: 'flat', obj: data },
    {
      shape: 'nested',
      obj: data?.data && typeof data.data === 'object' ? (data.data as WorkerPayload) : null,
    },
  ];

  for (const { shape, obj } of candidates) {
    if (!obj) continue;
    const fields = readFields(obj);
    if (fields) {
      return { ...fields, sourceShape: shape, rawKeys };
    }
  }

  return { sourceShape: 'none', rawKeys };
}
