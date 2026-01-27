/**
 * Tabs layout for main navigation screens.
 * Keeps screens mounted for instant switching (no remount on navigation).
 * The native tab bar is hidden - BottomTabBar provides the UI.
 */
import { useRef } from 'react';
import { Tabs } from 'expo-router';
import { PERF_DEBUG } from '@/lib/debug/renderTimer';

export default function TabsLayout() {
  // Performance: Track render count
  const renderCount = useRef(0);
  renderCount.current++;
  if (PERF_DEBUG) {
    console.log(`[RENDER] TabsLayout #${renderCount.current}`);
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Hide the native tab bar - BottomTabBar provides navigation UI
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Feed' }} />
      <Tabs.Screen name="fitness" options={{ title: 'Fitness' }} />
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="training" options={{ title: 'Training' }} />
      <Tabs.Screen name="wellness" options={{ title: 'Wellness' }} />
    </Tabs>
  );
}
