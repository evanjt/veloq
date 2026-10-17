/**
 * A screen's content, read by a screen reader after the screen's header.
 *
 * On Android a header laid over its content is added to the screen after the
 * content, so TalkBack would cross the whole page before it reached Back and
 * the title. The native container marks the content as read after the
 * header's last stop. iOS reads the header first already, and has no such
 * view, so there it is the content as it is.
 */

import React from 'react';
import { Platform, StyleSheet, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

let nativeView: React.ComponentType<ViewProps> | undefined;

export function ReadAfterHeader({ children }: { children: React.ReactElement }) {
  if (Platform.OS !== 'android') return children;
  nativeView ??= requireNativeViewManager<ViewProps>('VeloqFocus', 'ReadAfterHeaderView');
  const NativeReadAfterHeader = nativeView;
  return <NativeReadAfterHeader style={styles.fill}>{children}</NativeReadAfterHeader>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
