/**
 * SafeAreaView wrapper that automatically handles top safe area based on banner state.
 *
 * When a banner (demo, offline, cache loading) is showing at the top of the screen,
 * this component excludes the top edge from safe area to avoid double padding.
 * The banners already handle the top safe area, so screens don't need to.
 *
 * Use this instead of SafeAreaView from react-native-safe-area-context in screens.
 */

import React, { ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScreenSafeAreaEdges } from '@/shared/app/TopSafeAreaContext';

interface ScreenSafeAreaViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * The screen sits under a native stack header, which already clears the
   * status bar. Taking the top edge as well would pad it a second time.
   */
  hasNativeHeader?: boolean;
}

export function ScreenSafeAreaView({
  children,
  style,
  testID,
  hasNativeHeader = false,
}: ScreenSafeAreaViewProps) {
  const screenEdges = useScreenSafeAreaEdges();
  const edges = hasNativeHeader ? screenEdges.filter((edge) => edge !== 'top') : screenEdges;

  return (
    <SafeAreaView edges={edges} style={style} testID={testID}>
      {children}
    </SafeAreaView>
  );
}
