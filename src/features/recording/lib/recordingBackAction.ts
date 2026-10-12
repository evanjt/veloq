import type { RecordingStatus } from '../types';

/**
 * What the system back control does on the live screen or the review.
 *
 * - `consume`: back does nothing. The live screen is locked mid-ride, and the lock is the
 *   athlete's own statement that no input should act; or the review is saving and has hidden
 *   its own back control.
 * - `leave`: back leaves the unlocked live screen while the ride keeps recording, and the return
 *   pill brings the athlete back to it.
 * - `pass`: no ride is under way, so back is an ordinary back.
 */
export type RecordingBackAction = 'consume' | 'leave' | 'pass';

export function recordingBackAction({
  status,
  isLocked,
  isProcessing,
}: {
  status: RecordingStatus;
  isLocked: boolean;
  isProcessing: boolean;
}): RecordingBackAction {
  if (isProcessing) return 'consume';
  const underWay = status === 'recording' || status === 'paused';
  if (!underWay) return 'pass';
  return isLocked ? 'consume' : 'leave';
}
