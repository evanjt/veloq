/**
 * Tabs layout for main navigation screens.
 * Keeps screens mounted for instant switching (no remount on navigation).
 * The native tab bar is hidden - BottomTabBar provides the UI.
 */
import { useRef } from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PERF_DEBUG } from '@/shared/debug/renderTimer';
import { useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import { debug } from '@/shared/debug/debug';

const log = debug.create('TabsLayout');

export default function TabsLayout() {
  const { t } = useTranslation();
  // Remount frozen tabs on theme flip so PaperProvider's light/dark theme
  // actually propagates to screens that enableFreeze(true) has kept offscreen.
  const colorScheme = useResolvedColorScheme();
  // Performance: Track render count
  const renderCount = useRef(0);
  renderCount.current++;
  if (PERF_DEBUG) {
    log.log(`[RENDER] TabsLayout #${renderCount.current}`);
  }

  return (
    <Tabs
      key={colorScheme}
      screenOptions={{
        headerShown: false,
        // Hide the native tab bar - BottomTabBar provides navigation UI
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('navigation.feed') }} />
      <Tabs.Screen name="fitness" options={{ title: t('navigation.fitness') }} />
      <Tabs.Screen name="map" options={{ title: t('navigation.map') }} />
      <Tabs.Screen name="insights" options={{ title: t('navigation.insights') }} />
      <Tabs.Screen name="training" options={{ title: t('navigation.health') }} />
    </Tabs>
  );
}
