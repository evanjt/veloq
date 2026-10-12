/**
 * The app's one snackbar. A notice reports a change that has already happened, such as a saved
 * camera angle, a removed section or a finished restore, and may offer one action, usually Undo.
 *
 * The host owns every notice's lifetime and announcement, so no screen times or speaks its own:
 * - Every notice is announced on both platforms. Android would speak the live region the snackbar
 *   carries, but iOS ignores that prop.
 * - A notice with an action stays until it is acted on or dismissed while a screen reader runs,
 *   since its time is otherwise up before the action can be reached. Without one it keeps its
 *   duration.
 * - A second notice replaces the first rather than queueing.
 *
 * `NoticeHost` is mounted once above the navigator, so a notice outlives the screen that raised
 * it. `scripts/run-guards.mjs` refuses a `Snackbar` import from react-native-paper anywhere else.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Snackbar } from 'react-native-paper';

import { useTabBarClearance } from './tabBarClearance';

/** How long a notice stays when its caller names no duration. */
export const NOTICE_DEFAULT_MS = 4000;
/** For a notice of a sentence or more, which takes longer to read. */
export const NOTICE_LONG_MS = 7000;

export interface NoticeAction {
  label: string;
  onPress: () => void;
}

export interface NoticeArgs {
  message: string;
  action?: NoticeAction;
  /** Milliseconds on screen. A screen reader holds a notice with an action open past it. */
  duration?: number;
}

interface Notice {
  id: number;
  message: string;
  action: NoticeAction | undefined;
  duration: number;
}

let current: Notice | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function publish(notice: Notice | null): void {
  current = notice;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getCurrent(): Notice | null {
  return current;
}

/** Show a notice, replacing any on screen. Returns its id, which `hideNotice` takes. */
export function showNotice({ message, action, duration = NOTICE_DEFAULT_MS }: NoticeArgs): number {
  const id = nextId++;
  publish({ id, message, action, duration });
  AccessibilityInfo.announceForAccessibility(message);
  return id;
}

/** Hide the notice with this id. A later notice that replaced it stays. */
export function hideNotice(id: number): void {
  if (current?.id === id) publish(null);
}

function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (live) setEnabled(on);
      })
      .catch(() => {
        // A platform that cannot answer is treated as having no screen reader.
      });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

export function NoticeHost() {
  const notice = useSyncExternalStore(subscribe, getCurrent, getCurrent);
  const screenReaderOn = useScreenReaderEnabled();
  const tabBarClearance = useTabBarClearance();
  // Kept through the hide animation, which runs after the notice has cleared.
  const [shown, setShown] = useState(notice);
  if (notice && notice !== shown) setShown(notice);

  const held = notice?.action !== undefined && screenReaderOn;
  useEffect(() => {
    if (!notice || held) return undefined;
    const timer = setTimeout(() => hideNotice(notice.id), notice.duration);
    return () => clearTimeout(timer);
  }, [notice, held]);

  const action = shown?.action;
  return (
    <Snackbar
      testID="notice-snackbar"
      visible={notice !== null}
      onDismiss={() => {
        if (notice) hideNotice(notice.id);
      }}
      duration={Number.POSITIVE_INFINITY}
      {...(action && { action: { label: action.label, onPress: action.onPress } })}
      wrapperStyle={{ bottom: tabBarClearance }}
    >
      {shown?.message}
    </Snackbar>
  );
}
