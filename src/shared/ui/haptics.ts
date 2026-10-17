/**
 * The one importer of `expo-haptics`. Every haptic in the app is one of four
 * interaction classes, fires on both platforms and never rejects:
 *
 * | Class       | iOS feel             | Android feel    | Use it for                                                        |
 * |-------------|----------------------|-----------------|-------------------------------------------------------------------|
 * | `selection` | selection tick       | `Segment_Tick`  | a discrete choice: a tab, a sub-tab, a toggle, a picker           |
 * | `light`     | Light impact         | `Context_Click` | a button tap that acts, a long-press or scrub activation, a snap or boundary crossing |
 * | `medium`    | Medium impact        | `Long_Press`    | a destructive accept, an anchor placed, a refresh started, a card long-press opening its menu |
 * | `success`   | Success notification | `Confirm`       | a save or create that committed                                   |
 *
 * On Android every class goes through the view's haptic feedback, which the
 * device tunes and the system Touch feedback setting can turn off. The
 * package's other calls play a fixed vibrator waveform that ignores that
 * setting, so Android never reaches them.
 *
 * `scripts/lint-haptics-owner.mjs` refuses any other import of the package.
 */

import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

/** A device without a haptic engine, or a missing native module, is not an error. */
function fire(haptic: () => Promise<void>): void {
  try {
    haptic().catch(() => {});
  } catch {
    // Synchronous throw from the native module: nothing to feel, nothing to report.
  }
}

/** Fires the Android view haptic on Android and the iOS call everywhere else. */
function fireFor(android: ExpoHaptics.AndroidHaptics, ios: () => Promise<void>): void {
  if (Platform.OS === 'android') {
    fire(() => ExpoHaptics.performAndroidHapticsAsync(android));
  } else {
    fire(ios);
  }
}

export function selection(): void {
  fireFor(ExpoHaptics.AndroidHaptics.Segment_Tick, () => ExpoHaptics.selectionAsync());
}

export function light(): void {
  fireFor(ExpoHaptics.AndroidHaptics.Context_Click, () =>
    ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light)
  );
}

export function medium(): void {
  fireFor(ExpoHaptics.AndroidHaptics.Long_Press, () =>
    ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium)
  );
}

export function success(): void {
  fireFor(ExpoHaptics.AndroidHaptics.Confirm, () =>
    ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success)
  );
}

/**
 * Wraps a pull-to-refresh handler so the pull marks the moment it commits: one
 * medium impact, then the handler, before any state is set or work awaited. The
 * handler's result, a promise included, is returned as it is.
 */
export function onPullRefresh<Args extends unknown[], Result>(
  handler: (...args: Args) => Result
): (...args: Args) => Result {
  return (...args) => {
    medium();
    return handler(...args);
  };
}
