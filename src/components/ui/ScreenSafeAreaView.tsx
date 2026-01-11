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
import { useScreenSafeAreaEdges } from '@/providers/TopSafeAreaContext';

interface ScreenSafeAreaViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ScreenSafeAreaView({ children, style, testID }: ScreenSafeAreaViewProps) {
  const edges = useScreenSafeAreaEdges();

  return (
    <SafeAreaView edges={edges} style={style} testID={testID}>
      {children}
    </SafeAreaView>
  );
}
