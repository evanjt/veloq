/**
 * The message the section-creation overlay shows for a failed creation.
 *
 * The cut refuses with `NotFound` only when the ride it is cut from has no
 * stored track, which a sync fixes, so the screen chooses the message from the
 * engine's variant rather than from the error's text. Anything else reads as
 * the general failure.
 */

import { engineErrorTag } from '@/shared/native/engineError';

export type SectionCreationMessageKey =
  'routes.gpsTrackNotDownloaded' | 'routes.sectionCreationFailed';

export function sectionCreationMessageKey(error: unknown): SectionCreationMessageKey {
  if (engineErrorTag(error) === 'NotFound') return 'routes.gpsTrackNotDownloaded';
  return 'routes.sectionCreationFailed';
}
