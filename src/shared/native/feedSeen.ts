import { FfiFeedSeen } from 'veloqrs';
import { getEngine } from './engine';

/**
 * The feed's three reports to the engine, which decides the new-activity rings
 * from them. Best effort: a failed write leaves the rings as they were, so none
 * of these may throw into the caller.
 */
function report(event: FfiFeedSeen): void {
  try {
    getEngine()?.recordFeedSeen(event);
  } catch {
    // empty-on-error: the next open or close writes the marker again.
  }
}

/** The feed came into view: launch, or the app returning to the foreground. */
export function reportFeedOpened(): void {
  report(FfiFeedSeen.Opened.new());
}

/** The app left the foreground with the feed as the athlete last saw it. */
export function reportFeedClosed(): void {
  report(FfiFeedSeen.Closed.new());
}

/** The athlete tapped these cards, so their rings go. */
export function reportFeedDismissed(activityIds: readonly string[]): void {
  if (activityIds.length === 0) return;
  report(FfiFeedSeen.Dismissed.new({ activityIds: [...activityIds] }));
}
