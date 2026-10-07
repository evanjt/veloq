/**
 * Labels for preview centres.
 *
 * Every area is named by a letter in the order it is shown. It was numbered in
 * binKey order once, which is stable across limits but is not the order the
 * picker lays them out in, so a list of three drawn from six read "Area 5,
 * Area 6, Area 4". A number in display order fixed the sequence but still
 * reads as a rank the athlete could act on, and the bins are arbitrary
 * clusters, so the handle is a letter.
 */

import type { PreviewCentre } from 'veloqrs';

export interface CentreLabel {
  binKey: string;
  /** Position in the list as given, as a letter. */
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
    fallbackLetter: fallbackLetter(index),
  }));
}
