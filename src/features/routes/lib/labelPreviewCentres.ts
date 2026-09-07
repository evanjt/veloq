/**
 * Human labels for preview centres.
 *
 * A centre is a ~5 km riding-area bin. The label is the most common locality
 * among cached activities starting within the bin's radius, read from data
 * already on the device, never a network call. The radius is measured from the
 * bin's centre, the same box the camera frames, so the name and the map agree.
 * The engine's reported point is the mean of the bin's members and can sit near
 * an edge. Centres with no locality get a numbered fallback, numbered in the
 * order they are shown. It used to be binKey order, which is stable across
 * limits but is not the order the picker lays them out in, so a list of three
 * drawn from six read "Area 5, Area 6, Area 4" (B411).
 */

import { haversineDistance } from '@/shared/geo/distance';
import { previewAreaAnchor } from './previewMapCamera';
import type { PreviewCentre } from '../../../../modules/veloqrs/src/delegates/preview';

/** Half the bin diagonal plus slack for starts just outside a bin border. */
const CENTRE_RADIUS_M = 5000;

export interface CentreActivity {
  locality?: string;
  startLatLng?: [number, number];
}

export interface CentreLabel {
  binKey: string;
  /** Most common nearby locality, or null when none is known. */
  label: string | null;
  /** 1-based position in the list as given, for the numbered fallback. */
  fallbackNumber: number;
}

export function labelPreviewCentres(
  centres: PreviewCentre[],
  activities: CentreActivity[]
): CentreLabel[] {
  return centres.map((centre, index) => {
    const anchor = previewAreaAnchor(centre);
    const counts = new Map<string, number>();
    for (const activity of activities) {
      if (!activity.locality || !activity.startLatLng) continue;
      const [lat, lng] = activity.startLatLng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const metres = anchor
        ? haversineDistance({ lat, lng }, { lat: anchor[1], lng: anchor[0] })
        : Number.POSITIVE_INFINITY;
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
      fallbackNumber: index + 1,
    };
  });
}
