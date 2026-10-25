/**
 * The post-ride notification for a Garmin ride the phone pulled itself.
 *
 * The engine decides the ride is owed an entry (notifications on, no push
 * announced the same Garmin id) and says so on `bodyStored` with the kind
 * `ride_notification`. This posts it, with the text the push path builds, once
 * per ride.
 */

export const RIDE_NOTIFICATION_KIND = 'ride_notification';

export interface PulledRideEntry {
  title: string;
  body: string;
}

export interface PulledRideDeps {
  /** The title and body the engine builds for the ride, or null when it has none. */
  readEntry: (activityId: string) => PulledRideEntry | null | Promise<PulledRideEntry | null>;
  present: (activityId: string, title: string, body: string) => Promise<void>;
}

/**
 * A handler for `bodyStored` announcements. Resolves true when it posted an
 * entry. A ride already posted by this handler is not posted again, and one
 * whose post failed may be tried again.
 */
export function createPulledRidePoster(deps: PulledRideDeps) {
  const posted = new Set<string>();
  const inFlight = new Set<string>();

  return async (payload: unknown): Promise<boolean> => {
    const { kind, activityId } = (payload ?? {}) as { kind?: unknown; activityId?: unknown };
    if (kind !== RIDE_NOTIFICATION_KIND || typeof activityId !== 'string' || !activityId) {
      return false;
    }
    if (posted.has(activityId) || inFlight.has(activityId)) return false;

    inFlight.add(activityId);
    try {
      const entry = await deps.readEntry(activityId);
      if (!entry || !entry.body.trim()) return false;
      await deps.present(activityId, entry.title, entry.body);
      posted.add(activityId);
      return true;
    } catch {
      return false;
    } finally {
      inFlight.delete(activityId);
    }
  };
}
