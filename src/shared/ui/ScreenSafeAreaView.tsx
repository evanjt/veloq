/**
 * SafeAreaView wrapper that leaves the top edge to whatever already clears the status bar.
 *
 * When a banner (demo, offline, cache loading) is showing at the top of the screen, the banner
 * owns the top inset. When the navigator shows a native header, transparent or not, the header
 * owns it. In either case this component excludes the top edge to avoid double padding.
 *
 * Use this instead of SafeAreaView from react-native-safe-area-context in screens.
 */

import React, { ReactNode, useContext } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeaderShownContext } from 'expo-router/react-navigation';
import { useScreenSafeAreaEdges } from '@/shared/app/TopSafeAreaContext';
import { BottomInsetTaken } from './tabBarClearance';

interface ScreenSafeAreaViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ScreenSafeAreaView({ children, style, testID }: ScreenSafeAreaViewProps) {
  const screenEdges = useScreenSafeAreaEdges();
  const headerShown = useContext(HeaderShownContext);
  const edges = headerShown ? screenEdges.filter((edge) => edge !== 'top') : screenEdges;

  return (
    <SafeAreaView edges={edges} style={style} testID={testID}>
      <BottomInsetTaken.Provider value={edges.includes('bottom')}>
        {children}
      </BottomInsetTaken.Provider>
    </SafeAreaView>
  );
}
