import { useEffect, useState, useRef } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View, ActivityIndicator, Platform, AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Logger } from '@maplibre/maplibre-react-native';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { QueryProvider, MapPreferencesProvider, initializeTheme, useAuthStore, initializeSportPreference, initializeHRZones, initializeRouteMatching, initializeRouteSettings } from '@/providers';
import { lightTheme, darkTheme, colors, darkColors } from '@/theme';
import { CacheLoadingBanner } from '@/components/ui';
import { activitySyncManager } from '@/lib/activitySyncManager';
import { formatLocalDate } from '@/lib/format';

// Suppress MapLibre info/warning logs about canceled requests
// These occur when switching between map views but don't affect functionality
Logger.setLogLevel('error');

// Suppress Reanimated strict mode warnings from Victory Native charts
// These occur because Victory uses shared values during render (known library behavior)
configureReanimatedLogger({ level: ReanimatedLogLevel.error, strict: false });

function AuthGate({ children }: { children: React.ReactNode }) {
  const routeParts = useSegments();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();
  const appState = useRef(AppState.currentState);

  // Initialize route matching when authenticated
  // This subscribes to bounds sync completion to auto-trigger route processing
  useEffect(() => {
    if (isAuthenticated) {
      initializeRouteMatching();
    }
  }, [isAuthenticated]);

  // Check for new activities when app comes to foreground
  useEffect(() => {
    if (!isAuthenticated) return;

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // Detect transition from background/inactive to active (foreground)
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // Sync recent activities (last 7 days) to catch any new ones
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        activitySyncManager.syncDateRange(formatLocalDate(weekAgo), formatLocalDate(today), false);
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading) return;

    const inLoginScreen = routeParts.includes('login' as never);

    if (!isAuthenticated && !inLoginScreen) {
      // Not authenticated and not on login screen - redirect to login
      router.replace('/login' as Href);
    } else if (isAuthenticated && inLoginScreen) {
      // Authenticated but on login screen - redirect to main app
      router.replace('/' as Href);
    }
  }, [isAuthenticated, isLoading, routeParts, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: darkColors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <View style={{ flex: 1 }}>{children}</View>;
}

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  const initializeAuth = useAuthStore((state) => state.initialize);

  // Initialize theme, auth, sport preference, HR zones, and route settings on app start
  useEffect(() => {
    Promise.all([initializeTheme(), initializeAuth(), initializeSportPreference(), initializeHRZones(), initializeRouteSettings()]).finally(() => setAppReady(true));
  }, [initializeAuth]);

  // Show minimal loading while initializing
  if (!appReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: darkColors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <MapPreferencesProvider>
          <PaperProvider theme={theme}>
            <StatusBar
              style={colorScheme === 'dark' ? 'light' : 'dark'}
              translucent={Platform.OS === 'ios'}
              animated
            />
            <AuthGate>
              <CacheLoadingBanner />
              <Stack
                screenOptions={{
                  headerShown: false,
                  // iOS: Use default animation for native feel with gesture support
                  // Android: Slide from right for Material Design
                  animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
                  // iOS: Enable native swipe-back gesture
                  gestureEnabled: Platform.OS === 'ios',
                  gestureDirection: 'horizontal',
                  // iOS: Blur effect for any translucent headers
                  headerBlurEffect: Platform.OS === 'ios' ? 'prominent' : undefined,
                  headerTransparent: Platform.OS === 'ios',
                }}
              />
            </AuthGate>
          </PaperProvider>
        </MapPreferencesProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
