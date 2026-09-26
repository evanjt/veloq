/**
 * What a press looks like when it is not a `Button`.
 *
 * A tap answered three ways on one screen: the header arrow dimmed to React
 * Native's default 0.2, the action row to 0.7, and a `Pressable` with no
 * `pressed` style not at all. `Button` already carries the platform's answer,
 * a ripple on Android and a fade on iOS, and this is that same answer for
 * everything else: rows, chips, icons, map callouts.
 *
 * Android takes the ripple and no opacity, iOS the reverse, which is why the
 * ripple prop is undefined off Android rather than a second component.
 */

import { Platform } from 'react-native';
import type { PressableStateCallbackType, StyleProp, ViewStyle } from 'react-native';

/** How far a press fades on iOS. `Button`'s number, so the app has one. */
export const PRESS_OPACITY = 0.7;

/** The ripple a press draws on Android, and nothing anywhere else. */
export const pressRipple = Platform.select({
  android: { borderless: false },
  default: undefined,
});

/**
 * The `style` a `Pressable` takes so its press is visible.
 *
 * Pass whatever the element already had: `style={pressable(styles.row)}`, or
 * `style={pressable()}` where it had none. Give `android_ripple={pressRipple}`
 * beside it when the element has a ground to draw one on.
 */
export function pressable(
  style?: StyleProp<ViewStyle>
): (state: PressableStateCallbackType) => StyleProp<ViewStyle> {
  return ({ pressed }) => [
    style,
    pressed && Platform.OS !== 'android' ? { opacity: PRESS_OPACITY } : null,
  ];
}
