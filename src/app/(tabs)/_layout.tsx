/**
 * Tabs layout for main navigation screens.
 * Keeps screens mounted for instant switching (no remount on navigation).
 * The native tab bar is hidden - BottomTabBar provides the UI.
 * The group draws no header: each headered tab is a stack of its own, whose
 * header `TAB_HEADERS` declares, and the map stays full-bleed.
 */
import { useRef } from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PERF_DEBUG } from '@/shared/debug/renderTimer';
import { debug } from '@/shared/debug/debug';
import { TAB_TITLE_KEYS } from '@/shared/app/screenHeaders';
import { linkReturnsToItsTab } from '@/shared/app/tabHistory';

const log = debug.create('TabsLayout');

export default function TabsLayout() {
  const { t } = useTranslation();
  // Performance: Track render count
  const renderCount = useRef(0);
  renderCount.current++;
  if (PERF_DEBUG) {
    log.log(`[RENDER] TabsLayout #${renderCount.current}`);
  }

  return (
    <Tabs
      UNSTABLE_router={linkReturnsToItsTab}
      screenOptions={{
        // Each headered tab's own stack draws its header.
        headerShown: false,
        // Hide the native tab bar - BottomTabBar provides navigation UI
        tabBarStyle: { display: 'none' },
      }}
      // The tab group's own entry in the root stack takes the focused tab's title.
      screenListeners={({ navigation, route }) => ({
        focus: () => {
          const key = TAB_TITLE_KEYS[route.name];
          if (key) navigation.getParent()?.setOptions({ title: t(key) });
        },
      })}
    >
      {Object.entries(TAB_TITLE_KEYS).map(([name, key]) => (
        <Tabs.Screen key={name} name={name} options={{ title: t(key) }} />
      ))}
    </Tabs>
  );
}
