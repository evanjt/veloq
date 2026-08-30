/**
 * The live catalogue for one riding area, read straight from the engine.
 *
 * The preview screen opens on this so the first thing on the map is what the
 * detector holds today, before anything is proposed. The engine scopes it with
 * the same component a preview run uses, so the catalogue on screen is exactly
 * the one the next run diffs against.
 */

import { useMemo } from 'react';
import type {
  PreviewClient,
  PreviewSection,
} from '../../../../modules/veloqrs/src/delegates/preview';

export function usePreviewCurrentSections(
  client: PreviewClient | null,
  centre: { lat: number; lng: number } | null
): PreviewSection[] {
  const lat = centre?.lat ?? null;
  const lng = centre?.lng ?? null;

  return useMemo(() => {
    if (!client || lat === null || lng === null) return [];
    try {
      return client.getPreviewCurrentSections(lat, lng);
    } catch {
      return [];
    }
  }, [client, lat, lng]);
}
