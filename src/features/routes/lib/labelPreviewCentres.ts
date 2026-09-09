/**
 * Human labels for preview centres.
 *
 * The name itself comes from the engine, which joins each ~5 km bin against
 * the stored activity bodies over the whole library (`preview_centres` in
 * `persistence/sections/preview.rs`). It used to be joined here, against a
 * synced window and on `start_latlng`, a field the sync never fetches, so
 * every centre fell back (B422, B423).
 *
 * What is left here is the fallback: a centre the engine could not name gets a
 * letter in the order it is shown. It was numbered in binKey order once, which
 * is stable across limits but is not the order the picker lays them out in, so
 * a list of three drawn from six read "Area 5, Area 6, Area 4" (B411). A
 * number in display order fixed the sequence but still reads as a rank the
 * athlete could act on, and the bins are arbitrary clusters, so the handle is
 * a letter.
 */

import type { PreviewCentre } from '../../../../modules/veloqrs/src/delegates/preview';

export interface CentreLabel {
  binKey: string;
  /** The engine's name for the area, or null when it has none. */
  label: string | null;
  /** Position in the list as given, as a letter, for the lettered fallback. */
  fallbackLetter: string;
}

/**
 * A, B, ... Z, AA, AB, the spreadsheet column sequence. A library with more
 * than 26 unnamed areas is unlikely, but a blank chip past Z is not a failure
 * anyone would think to look for.
 */
export function fallbackLetter(index: number): string {
  let letter = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
  }
  return letter;
}

export function labelPreviewCentres(centres: PreviewCentre[]): CentreLabel[] {
  return centres.map((centre, index) => ({
    binKey: centre.binKey,
    label: centre.locality ?? null,
    fallbackLetter: fallbackLetter(index),
  }));
}
