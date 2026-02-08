/**
 * Tabs layout for main navigation screens.
 * Keeps screens mounted for instant switching (no remount on navigation).
 * The native tab bar is hidden - BottomTabBar provides the UI.
 */
import { useRef } from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PERF_DEBUG } from '@/lib/debug/renderTimer';

export default function TabsLayout() {
  const { t } = useTranslation();
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
      <Tabs.Screen name="index" options={{ title: t('navigation.feed') }} />
      <Tabs.Screen name="fitness" options={{ title: t('navigation.fitness') }} />
      <Tabs.Screen name="map" options={{ title: t('navigation.map') }} />
      <Tabs.Screen name="routes" options={{ title: t('navigation.routes') }} />
      <Tabs.Screen name="training" options={{ title: t('navigation.health') }} />
    </Tabs>
  );
}
