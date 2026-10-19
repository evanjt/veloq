/**
 * The shape of one webhook delivery, for reading in a live `wrangler tail`.
 *
 * Only one athlete's events are described, the one named by the worker's
 * `WEBHOOK_SHAPE_ATHLETE` secret, and only by type, timestamp, activity id and
 * the names of the activity's keys. The push promises to carry nothing beyond
 * the event type, activity id and athlete id, and this line holds to the same:
 * no secret, no other athlete, no activity value but its id. The athlete's own
 * id is left out too, since the secret already names it.
 */

interface ShapeEvent {
  type?: string;
  timestamp?: string;
  activityId?: string;
  activityKeys?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/**
 * One log line for the delivery, or null when no athlete is named or no event
 * in the delivery is that athlete's. The event count is the delivery's whole,
 * taken before any filtering or dedupe.
 */
export function webhookShapeLine(
  payload: unknown,
  receivedAt: string,
  athleteId: string | undefined
): string | null {
  if (!athleteId || !isRecord(payload) || !Array.isArray(payload.events)) return null;

  const events: ShapeEvent[] = [];
  for (const event of payload.events) {
    if (!isRecord(event) || scalar(event.athlete_id) !== athleteId) continue;
    const shape: ShapeEvent = {};
    const type = scalar(event.type);
    if (type !== undefined) shape.type = type;
    const timestamp = scalar(event.timestamp);
    if (timestamp !== undefined) shape.timestamp = timestamp;
    if (isRecord(event.activity)) {
      const activityId = scalar(event.activity.id);
      if (activityId !== undefined) shape.activityId = activityId;
      shape.activityKeys = Object.keys(event.activity).sort();
    }
    events.push(shape);
  }
  if (events.length === 0) return null;

  return `webhook-shape ${JSON.stringify({
    receivedAt,
    eventCount: payload.events.length,
    keys: Object.keys(payload)
      .filter((key) => key !== "secret")
      .sort(),
    events,
  })}`;
}
