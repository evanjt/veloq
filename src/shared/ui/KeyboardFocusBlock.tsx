/**
 * A container whose contents take no keyboard focus, for a control drawn inside
 * an element that already is that control, such as the switch at the end of a
 * `SwitchRow`. Touch still reaches what it holds.
 *
 * Android's native switch is focusable and takes no `focusable` prop, so the
 * container is a native view that blocks focus to its descendants. Elsewhere it
 * is a plain view.
 */

import React from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

let nativeView: React.ComponentType<ViewProps> | undefined;

export function KeyboardFocusBlock(props: ViewProps) {
  if (Platform.OS !== 'android') return <View {...props} />;
  nativeView ??= requireNativeViewManager<ViewProps>('VeloqFocus');
  const NativeKeyboardFocusBlock = nativeView;
  return <NativeKeyboardFocusBlock {...props} />;
}
