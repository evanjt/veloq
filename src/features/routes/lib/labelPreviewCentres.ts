/**
 * Human labels for preview centres.
 *
 * A centre is a ~5 km riding-area bin. The label is the most common locality
 * among cached activities starting within the bin's radius, read from data
 * already on the device, never a network call. Centres with no locality get a
 * numbered fallback, numbered in binKey order so the numbering is stable
 * across renders and limits.
 */

import { haversineDistance } from '@/shared/geo/distance';
import type { PreviewCentre } from '../../../../modules/veloqrs/src/delegates/preview';

/** Half the ~5 km bin edge plus slack for starts near a bin border. */
const CENTRE_RADIUS_M = 5000;

export interface CentreActivity {
  locality?: string;
  startLatLng?: [number, number];
}

export interface CentreLabel {
  binKey: string;
  /** Most common nearby locality, or null when none is known. */
  label: string | null;
  /** 1-based rank of binKey ascending, for the numbered fallback. */
  fallbackNumber: number;
}

export function labelPreviewCentres(
  centres: PreviewCentre[],
  activities: CentreActivity[]
): CentreLabel[] {
  const ordered = [...centres].sort((a, b) => a.binKey.localeCompare(b.binKey));
  const numberByBin = new Map(ordered.map((c, i) => [c.binKey, i + 1]));

  return centres.map((centre) => {
    const counts = new Map<string, number>();
    for (const activity of activities) {
      if (!activity.locality || !activity.startLatLng) continue;
      const [lat, lng] = activity.startLatLng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const metres = haversineDistance({ lat, lng }, { lat: centre.lat, lng: centre.lng });
      if (metres > CENTRE_RADIUS_M) continue;
      counts.set(activity.locality, (counts.get(activity.locality) ?? 0) + 1);
    }

    let label: string | null = null;
    let best = 0;
    for (const [locality, count] of counts) {
      if (count > best || (count === best && label !== null && locality < label)) {
        label = locality;
        best = count;
      }
    }

    return {
      binKey: centre.binKey,
      label,
      fallbackNumber: numberByBin.get(centre.binKey) ?? 0,
    };
  });
}
