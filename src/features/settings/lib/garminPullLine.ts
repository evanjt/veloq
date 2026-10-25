import type { FfiGarminPull } from 'veloqrs';
import { FfiGarminHalt, FfiGarminPullPhase } from 'veloqrs';

/** The pull's status as a catalogue key and the time it names. */
export interface GarminPullLine {
  key:
    | 'garmin.pullRunning'
    | 'garmin.pullPaused'
    | 'garmin.pullDone'
    | 'garmin.pullIdle'
    | 'garmin.pullStoppedKey'
    | 'garmin.pullStoppedUnreachable'
    | 'garmin.pullStoppedStorage';
  time: string;
}

/** The month `YYYY-MM` as the locale writes it, or the text itself when it does not parse. */
export function formatPullMonth(month: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** What the row says about the pass, in the connector's words. */
export function garminPullLine(pull: FfiGarminPull, locale: string): GarminPullLine {
  switch (pull.phase) {
    case FfiGarminPullPhase.Running:
      return { key: 'garmin.pullRunning', time: '' };
    case FfiGarminPullPhase.Paused: {
      const until = pull.resumeAt === undefined ? null : new Date(pull.resumeAt);
      return {
        key: 'garmin.pullPaused',
        time: until ? until.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) : '',
      };
    }
    case FfiGarminPullPhase.Done:
      return { key: 'garmin.pullDone', time: '' };
    case FfiGarminPullPhase.Stopped:
      return { key: STOPPED_KEY[pull.halt ?? FfiGarminHalt.Unreachable], time: '' };
    default:
      return { key: pull.backfillDone ? 'garmin.pullDone' : 'garmin.pullIdle', time: '' };
  }
}

const STOPPED_KEY = {
  [FfiGarminHalt.KeyRejected]: 'garmin.pullStoppedKey',
  [FfiGarminHalt.Unreachable]: 'garmin.pullStoppedUnreachable',
  [FfiGarminHalt.Unstorable]: 'garmin.pullStoppedStorage',
} as const;

/** Whether Pull now is offered: a paused or stopped pass, or an idle one with history still to walk. */
export function offersPullNow(pull: FfiGarminPull): boolean {
  switch (pull.phase) {
    case FfiGarminPullPhase.Paused:
    case FfiGarminPullPhase.Stopped:
      return true;
    case FfiGarminPullPhase.Idle:
      return !pull.backfillDone;
    default:
      return false;
  }
}
