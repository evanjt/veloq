/**
 * The one container every map WebView is rendered in.
 *
 * A WebView and the page inside it are two focus stops on Android, for the
 * keyboard and for a screen reader, and neither carries a name or answers a
 * key. So the host takes the WebView and everything in it out of both, while
 * touch still reaches the page. The map's actions are its native controls,
 * which sit outside the WebView.
 *
 * Given a label, the host is one image element carrying it, so a screen reader
 * hears what the map shows. Given none, the map exposes nothing.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardFocusBlock } from '@/shared/ui/KeyboardFocusBlock';

interface MapWebViewHostProps {
  style?: StyleProp<ViewStyle>;
  /** What the map shows, for a screen reader. Omitted, the map is hidden from it. */
  accessibilityLabel?: string | undefined;
  children: React.ReactNode;
}

export function MapWebViewHost({ style, accessibilityLabel, children }: MapWebViewHostProps) {
  if (!accessibilityLabel) {
    return (
      <KeyboardFocusBlock
        style={style}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {children}
      </KeyboardFocusBlock>
    );
  }
  return (
    <View
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <KeyboardFocusBlock
        style={StyleSheet.absoluteFill}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {children}
      </KeyboardFocusBlock>
    </View>
  );
}
