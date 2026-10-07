/**
 * Whether arriving at the recording screen starts the ride or leaves it idle.
 *
 * Every one-tap surface, the home-screen widget, an iOS Control and a launcher
 * shortcut, deep-links straight to this screen, so the mount alone would have
 * recorded a pocket tap. Those arrivals land idle with the map in view and a
 * Start button. The Start on the entry screen and the picker are the athlete's
 * own tap and begin on arrival. Every arrival from the system, a link in
 * another app or a web page, is rewritten to carry the quick-start mark too.
 */
import type { RecordingMode, RecordingStatus } from '../types';

/** The query parameter every one-tap surface deep-links with. */
export const QUICKSTART_ENTRY = 'quickstart';

/** The query parameter the entry screen's Start navigates with. */
export const ENTRY_SCREEN_ENTRY = 'entry';

export type StartPlan = 'start' | 'nothing';

export function canStartAfterScopeWarning(
  canRecord: boolean,
  reason: 'ok' | 'no_permission' | 'not_signed_in' | 'checking',
  recordingWithoutScope: boolean
): boolean {
  return canRecord || (reason === 'no_permission' && recordingWithoutScope);
}

export function planRecordingStart(entry: {
  canRecord: boolean;
  status: RecordingStatus;
  from: string | undefined;
  mode?: RecordingMode;
}): StartPlan {
  // Not a courtesy: this is the only thing between a signed-out tap and a full
  // ride recorded against no account.
  if (!entry.canRecord) return 'nothing';
  if (entry.status !== 'idle') return 'nothing';
  if (entry.mode === 'manual') return 'nothing';
  return entry.from === QUICKSTART_ENTRY ? 'nothing' : 'start';
}

const RECORDING_PATH = /^((?:[a-z][a-z0-9+.-]*:\/\/|\/)recording\/[^/?#]+)(?:\?([^#]*))?(#.*)?$/i;

/** Marks a system-supplied recording path as a quick start, replacing any `from` it carried. */
export function armSystemRecordingPath(path: string): string {
  const match = RECORDING_PATH.exec(path);
  if (!match) return path;
  const [, base, query = '', hash = ''] = match;
  const kept = query.split('&').filter((pair) => pair !== '' && pair.split('=')[0] !== 'from');
  kept.push(`from=${QUICKSTART_ENTRY}`);
  return `${base}?${kept.join('&')}${hash}`;
}
