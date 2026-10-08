/** Where the tour carousel stands when the athlete comes back to it. */
export interface TourResumeMotion {
  /** The slide the card opens on. */
  openOn: number;
  /** The slide it then moves to with the normal slide transition, or null to stay. */
  slideTo: number | null;
}

/**
 * Back to Tour reopens on the slide whose Show Me was used and slides on to the
 * next one, so the move is seen. With reduced motion it lands on the next slide.
 */
export function tourResumeMotion(
  tour: { shownIndex: number | null; resumeIndex: number },
  reduceMotion: boolean
): TourResumeMotion {
  const { shownIndex, resumeIndex } = tour;
  if (reduceMotion || shownIndex === null || shownIndex === resumeIndex) {
    return { openOn: resumeIndex, slideTo: null };
  }
  return { openOn: shownIndex, slideTo: resumeIndex };
}
