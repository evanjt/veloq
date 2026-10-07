/**
 * The sport a section or route is read in when nothing picked one: the one
 * sport that has taken it, or none when several have, since ground has no
 * sport of its own and the busiest is not the ground's.
 */
export function onlySport(sportTypes: readonly string[] | undefined): string | undefined {
  return sportTypes?.length === 1 ? sportTypes[0] : undefined;
}
