/**
 * The widths a detail map draws its subject line at, shared by the flat
 * builders and the 3D pages so the two cannot drift apart.
 */

/** The subject line: the activity, route or section the map is about. */
export const SUBJECT_LINE_WIDTH = 4;
/** The casing under the subject line, which shows as a thin edge either side. */
export const SUBJECT_CASING_WIDTH = 5;
/**
 * The matched route runs under the activity track, often within a metre of it.
 * It is context, so it takes the base's muted colour and no casing, and it is
 * wider than the track above it so a margin of it shows on either side.
 */
export const OVERLAY_LINE_WIDTH = 8;

/** A 3D page draws every flat width and marker size at this fraction. */
export const MAP_3D_SCALE = 0.75;
