/**
 * The live catalogue for one riding area, read straight from the engine.
 *
 * The preview screen opens on this so the first thing on the map is what the
 * detector holds today, before anything is proposed. The engine scopes it with
 * the same component a preview run uses, so the catalogue on screen is exactly
 * the one the next run diffs against.
 *
 * An area that holds nothing and a read that failed both draw a blank map, so
 * the hook keeps them apart and the screen says which one it is showing.
 */

import { useMemo } from 'react';
import type {
  PreviewClient,
  PreviewSection,
} from '../../../../modules/veloqrs/src/delegates/preview';

export interface PreviewCurrentSections {
  sections: PreviewSection[];
  /** The engine could not be read. An empty area leaves this false. */
  failed: boolean;
}

const NOTHING: PreviewCurrentSections = { sections: [], failed: false };
const FAILED: PreviewCurrentSections = { sections: [], failed: true };

export function usePreviewCurrentSections(
  client: PreviewClient | null,
  centre: { lat: number; lng: number } | null
): PreviewCurrentSections {
  const lat = centre?.lat ?? null;
  const lng = centre?.lng ?? null;

  return useMemo(() => {
    if (!client || lat === null || lng === null) return NOTHING;
    try {
      const sections = client.getPreviewCurrentSections(lat, lng);
      return sections ? { sections, failed: false } : FAILED;
    } catch {
      return FAILED;
    }
  }, [client, lat, lng]);
}
