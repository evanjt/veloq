/**
 * The one importer of `expo-haptics`. Every haptic in the app is one of four
 * interaction classes, fires on both platforms and never rejects:
 *
 * | Class       | Feel                  | Use it for                                                        |
 * |-------------|-----------------------|-------------------------------------------------------------------|
 * | `selection` | selection tick        | a discrete choice: a tab, a sub-tab, a toggle, a picker           |
 * | `light`     | Light impact          | a button or navigation tap, a long-press or scrub activation, a snap or boundary crossing |
 * | `medium`    | Medium impact         | a destructive accept, an anchor placed, a refresh started, a card long-press opening its menu |
 * | `success`   | Success notification  | a save or create that committed                                   |
 *
 * `scripts/lint-haptics-owner.mjs` refuses any other import of the package.
 */

import * as ExpoHaptics from 'expo-haptics';

/** A device without a haptic engine, or a missing native module, is not an error. */
function fire(haptic: () => Promise<void>): void {
  try {
    haptic().catch(() => {});
  } catch {
    // Synchronous throw from the native module: nothing to feel, nothing to report.
  }
}

export function selection(): void {
  fire(() => ExpoHaptics.selectionAsync());
}

export function light(): void {
  fire(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light));
}

export function medium(): void {
  fire(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium));
}

export function success(): void {
  fire(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success));
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
