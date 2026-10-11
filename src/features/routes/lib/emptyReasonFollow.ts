/**
 * When an empty list's reason has to be read again without an announcement.
 *
 * A detect's progress, a held detect and a detect about to start have no
 * observer event, so while a list says one of them the screen re-reads on the
 * shared routes status tick, and only when a job it names has moved.
 */

import {
  FfiCatalogueEmptyReason_Tags,
  type FfiCatalogueEmptyReason,
  type RoutesStatus,
} from 'veloqrs';

/** Whether the reason can change with no event to say so. */
export function reasonMovesOnItsOwn(reason: FfiCatalogueEmptyReason | null | undefined): boolean {
  if (!reason) return false;
  return (
    reason.tag === FfiCatalogueEmptyReason_Tags.Running ||
    reason.tag === FfiCatalogueEmptyReason_Tags.Held ||
    reason.tag === FfiCatalogueEmptyReason_Tags.NotYetRun
  );
}

/** The figures of one status read that an empty reason is made from. */
export function reasonJobsKey(status: RoutesStatus | null): string {
  if (!status) return 'none';
  return [
    status.detection ? `${status.detection.phase}:${status.detection.percent}` : 'idle',
    status.detectionOutcome,
    status.elevation.phase,
    status.elevationRemaining ?? 'unknown',
    status.elevationPaused ? 'paused' : 'live',
    status.cutover.phase,
    status.cutover.running ? 'cutting' : 'resting',
  ].join('|');
}
