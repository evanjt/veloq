/**
 * The message the section-creation overlay shows for a failed creation.
 *
 * The engine tags a failure an athlete can act on with a `reason`, so the screen
 * chooses the message from the tag rather than from the error's text. Anything
 * else reads as the general failure.
 */

export type SectionCreationMessageKey =
  'routes.gpsTrackNotDownloaded' | 'routes.sectionCreationFailed';

export function sectionCreationMessageKey(error: unknown): SectionCreationMessageKey {
  const reason =
    error instanceof Error && 'reason' in error ? (error as { reason: unknown }).reason : undefined;
  if (reason === 'noTrack') return 'routes.gpsTrackNotDownloaded';
  return 'routes.sectionCreationFailed';
}
