import * as SplashScreen from 'expo-splash-screen';

import { duration } from '@/theme';

// The native splash stays up until the first screen is ready, so the athlete
// sees one launch screen rather than the splash followed by a spinner.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// The hand-off cross-fades into the first screen. iOS cuts without `fade`, and
// Android takes the same `duration` for its exit, so one value serves both.
try {
  SplashScreen.setOptions({ fade: true, duration: duration.slow });
} catch {
  // Without the native module the splash keeps its default hand-off.
}

let released = false;

/** Hides the native splash once; later calls and a rejected hide do nothing. */
export function releaseSplash(): void {
  if (released) return;
  released = true;
  void SplashScreen.hideAsync().catch(() => {});
}

/** The longest a signed-in launch holds the splash for a feed read that never settles. */
export const FEED_HOLD_MS = 1500;

export interface SplashGate {
  appReady: boolean;
  authLoading: boolean;
  signedIn: boolean;
  /** The feed's first read has resolved, with rows or without. */
  feedSettled: boolean;
}

/**
 * The splash holds until the screen behind it has data: the signed-out and
 * demo-less launch has no feed to wait for, a signed-in one waits for its
 * first read so the fade reveals cards rather than an empty list.
 */
export function shouldReleaseSplash(gate: SplashGate): boolean {
  if (!gate.appReady || gate.authLoading) return false;
  return !gate.signedIn || gate.feedSettled;
}
