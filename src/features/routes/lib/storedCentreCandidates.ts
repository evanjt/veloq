/**
 * Locality candidates for the preview picker, read from everything stored.
 *
 * The picker used to join against `useActivities({ days: 365 })`, which asks
 * the engine to fetch a window it may not hold and drops any riding area last
 * ridden more than a year ago. An area is ranked by its whole history, so its
 * name has to come from the same place: the stored bodies, over all of time,
 * with no sync of its own (B422).
 */

import { getEngine } from '@/shared/native/engine';
import type { CentreActivity } from './labelPreviewCentres';

interface StoredBody {
  locality?: unknown;
  start_latlng?: unknown;
}

function startLatLng(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [lat, lng] = value;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  return [lat, lng];
}

/** Every stored activity reduced to the two fields the join reads. */
export function readStoredCentreCandidates(): CentreActivity[] {
  const engine = getEngine();
  if (!engine?.getActivityBodies) return [];

  const now = Math.floor(Date.now() / 1000);
  let bodies: string[] = [];
  try {
    bodies = engine.getActivityBodies(0, now);
  } catch {
    return [];
  }

  const out: CentreActivity[] = [];
  for (const body of bodies) {
    try {
      const parsed = JSON.parse(body) as StoredBody;
      out.push({
        locality: typeof parsed.locality === 'string' ? parsed.locality : undefined,
        startLatLng: startLatLng(parsed.start_latlng),
      });
    } catch {
      // A body we cannot parse is a corrupt row, not an activity with no name.
    }
  }
  return out;
}
