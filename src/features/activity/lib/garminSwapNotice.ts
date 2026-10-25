import { SwapOutcome } from 'veloqrs';

import type { StatusTone } from '@/shared/ui';

/** What the athlete asked for: Garmin's file in, or intervals.icu's earlier file back. */
export type GarminSwapAction = 'swap' | 'undo';

type NoticeKey =
  | 'activity.garminSwap.replaced'
  | 'activity.garminSwap.restored'
  | 'activity.garminSwap.unchanged'
  | 'activity.garminSwap.refused'
  | 'activity.garminSwap.permission'
  | 'activity.garminSwap.signedOut'
  | 'activity.garminSwap.notEligible'
  | 'activity.garminSwap.mismatch'
  | 'activity.garminSwap.garminUnavailable'
  | 'activity.garminSwap.failed'
  | 'activity.garminSwap.undoFailed';

export interface GarminSwapNotice {
  /** The locale key of the line shown under the button. */
  key: NoticeKey;
  tone: StatusTone;
  /** Whether intervals.icu's file changed, so the activity is read again. */
  rereads: boolean;
}

/**
 * The line an outcome is shown as. The engine decides the outcome and this only
 * words it, so a refusal is told apart from a failure: a refusal means
 * intervals.icu would not take the file and nothing changed.
 */
export function garminSwapNotice(outcome: SwapOutcome, action: GarminSwapAction): GarminSwapNotice {
  const line = (key: NoticeKey, tone: StatusTone, rereads = false): GarminSwapNotice => ({
    key,
    tone,
    rereads,
  });
  switch (outcome) {
    case SwapOutcome.Replaced:
      return line('activity.garminSwap.replaced', 'success', true);
    case SwapOutcome.Restored:
      return line('activity.garminSwap.restored', 'success', true);
    case SwapOutcome.Unchanged:
      return line('activity.garminSwap.unchanged', 'info');
    case SwapOutcome.Refused:
      return line('activity.garminSwap.refused', 'error');
    case SwapOutcome.PermissionBlocked:
      return line('activity.garminSwap.permission', 'error');
    case SwapOutcome.AuthExpired:
      return line('activity.garminSwap.signedOut', 'error');
    case SwapOutcome.NotEligible:
      return line('activity.garminSwap.notEligible', 'error');
    case SwapOutcome.Mismatch:
      return line('activity.garminSwap.mismatch', 'error', true);
    case SwapOutcome.GarminUnavailable:
      return line('activity.garminSwap.garminUnavailable', 'error');
    case SwapOutcome.Failed:
    default:
      return line(
        action === 'undo' ? 'activity.garminSwap.undoFailed' : 'activity.garminSwap.failed',
        'error'
      );
  }
}
