/**
 * Tabs layout for main navigation screens.
 * Keeps screens mounted for instant switching (no remount on navigation).
 * The native tab bar is hidden - FloatingMenu provides the UI.
 */
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Hide the native tab bar - FloatingMenu provides navigation UI
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
