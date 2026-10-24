/**
 * The one press target the shared controls render through.
 *
 * A `Pressable` answers a press and nothing else: the ripple, the iOS fade and
 * the keyboard focus ring are each a prop or a style a call site has to add,
 * and focus is not in the style callback's state at all. This holds all three,
 * so a control that renders through it presses and focuses like every other.
 *
 * Focus is state held here, from `onFocus` and `onBlur`, and any handler the
 * caller gave is still called.
 */

import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  type NativeSyntheticEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TargetedEvent,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/shared/app';

import { focusRing, pressable, pressRipple, pressRippleOver } from './pressFeedback';

export interface PressTargetProps extends Omit<PressableProps, 'android_ripple' | 'style'> {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  /**
   * Where the Android ripple draws: under the child, or over it for a child
   * that paints an opaque ground of its own, such as a card. `none` draws no
   * ripple, for a control that answers a press in its own content.
   */
  ripple?: 'under' | 'over' | 'none' | undefined;
  /**
   * Whether the target fades on iOS while pressed. Off for a control that sets
   * its own opacity, such as `Button`, which also dims when disabled.
   */
  fade?: boolean | undefined;
  /**
   * The scheme the ring is drawn for, for a target drawn outside the theme,
   * such as the crash screen, which reads the system appearance.
   */
  dark?: boolean | undefined;
  ref?: React.Ref<ViewInstance> | undefined;
}

export function PressTarget({
  style,
  ripple = 'under',
  fade = true,
  dark,
  disabled,
  onFocus,
  onBlur,
  ref,
  ...props
}: PressTargetProps) {
  const theme = useTheme();
  const isDark = dark ?? theme.isDark;
  const [focused, setFocused] = useState(false);

  const handleFocus = (event: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(true);
    onFocus?.(event);
  };
  const handleBlur = (event: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(false);
    onBlur?.(event);
  };

  return (
    <Pressable
      {...props}
      ref={ref}
      disabled={disabled}
      android_ripple={
        disabled || ripple === 'none'
          ? undefined
          : ripple === 'over'
            ? pressRippleOver
            : pressRipple
      }
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={(state) => {
        const own = typeof style === 'function' ? style(state) : style;
        return [fade ? pressable(own)(state) : own, focusRing(focused, isDark, Platform.OS)];
      }}
    />
  );
}
