/**
 * How the live recording screen's top region shares its height.
 *
 * The bottom slot (the controls, or the unlock track while locked) sits
 * outside the region and is laid out first, so it is never the part a short
 * window loses. Inside the region the header, banners and tiles keep their
 * natural height and the map takes what is left, down to zero. When those
 * alone overflow the region, as in a small split-screen pane or at a large
 * text size, the region scrolls and the map stays mounted at zero height.
 */

export interface RecordingColumnInput {
  /** Height of the region above the bottom slot. */
  regionHeight: number;
  /** Summed height of everything in the region but the map. */
  fixedContentHeight: number;
}

export interface RecordingColumnLayout {
  mapHeight: number;
  scrolls: boolean;
}

export function recordingColumnLayout({
  regionHeight,
  fixedContentHeight,
}: RecordingColumnInput): RecordingColumnLayout {
  const left = regionHeight - fixedContentHeight;
  return { mapHeight: Math.max(0, left), scrolls: left < 0 };
}
