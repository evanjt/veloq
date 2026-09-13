/**
 * Whether arriving at the recording screen starts the ride, or arms it.
 *
 * Every one-tap surface, the home-screen widget, an iOS Control and a launcher
 * shortcut, deep-links straight to this screen, so the mount was the whole
 * decision and a pocket tap recorded a ride. Evan's decision of 2026-09-11:
 * a tap arms the screen with the sport chosen and a countdown that auto-starts
 * unless cancelled, which is one tap in practice and accident-proof.
 *
 * The picker path is different: the athlete has already tapped the sport, so
 * arriving there is their second tap and the ride starts on it.
 */
import type { RecordingStatus } from '../types';

/** The decision's own number. Long enough to notice, short enough not to nag. */
export const ARM_COUNTDOWN_SECONDS = 3;

/** The query parameter every one-tap surface deep-links with. */
export const QUICKSTART_ENTRY = 'quickstart';

export type StartPlan = 'start' | 'arm' | 'nothing';

export function planRecordingStart(entry: {
  canRecord: boolean;
  status: RecordingStatus;
  from: string | undefined;
}): StartPlan {
  // Not a courtesy: this is the only thing between a signed-out tap and a full
  // ride recorded against no account.
  if (!entry.canRecord) return 'nothing';
  if (entry.status !== 'idle') return 'nothing';
  return entry.from === QUICKSTART_ENTRY ? 'arm' : 'start';
}
