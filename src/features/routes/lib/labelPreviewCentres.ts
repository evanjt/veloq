/**
 * Human labels for preview centres.
 *
 * The name itself comes from the engine, which joins each ~5 km bin against
 * the stored activity bodies over the whole library (`preview_centres` in
 * `persistence/sections/preview.rs`). It used to be joined here, against a
 * synced window and on `start_latlng`, a field the sync never fetches, so
 * every centre fell back (B422, B423).
 *
 * What is left here is the fallback: a centre the engine could not name is
 * numbered in the order it is shown. It used to be binKey order, which is
 * stable across limits but is not the order the picker lays them out in, so a
 * list of three drawn from six read "Area 5, Area 6, Area 4" (B411).
 */

import type { PreviewCentre } from '../../../../modules/veloqrs/src/delegates/preview';

export interface CentreLabel {
  binKey: string;
  /** The engine's name for the area, or null when it has none. */
  label: string | null;
  /** 1-based position in the list as given, for the numbered fallback. */
  fallbackNumber: number;
}

export function labelPreviewCentres(centres: PreviewCentre[]): CentreLabel[] {
  return centres.map((centre, index) => ({
    binKey: centre.binKey,
    label: centre.locality ?? null,
    fallbackNumber: index + 1,
  }));
}
