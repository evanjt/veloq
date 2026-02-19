// Enable screen freezing BEFORE any other imports
// This prevents inactive screens from re-rendering during navigation
import { enableFreeze } from 'react-native-screens';
enableFreeze(true);

import { LogBox } from 'react-native';
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'Sending `onAnimatedValueUpdate` with no listeners registered',
  'VirtualizedLists should never be nested inside plain ScrollViews',
]);

import { useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { AppState, useColorScheme, View, ActivityIndicator, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import MapLibre, { Logger as MapLibreLogger } from '@maplibre/maplibre-react-native';
import {
  QueryProvider,
  queryClient,
  MapPreferencesProvider,
  NetworkProvider,
  TopSafeAreaProvider,
  initializeTheme,
  useAuthStore,
  initializeSportPreference,
  initializeHRZones,
  initializeRouteSettings,
  initializeLanguage,
  initializeSupersededSections,
  initializeDisabledSections,
  initializeUnitPreference,
  initializeDashboardPreferences,
  initializeDebugStore,
  useSyncDateRange,
} from '@/providers';
import { formatLocalDate } from '@/lib';
import { initializeI18n, i18n } from '@/i18n';
import { lightTheme, darkTheme, colors, darkColors } from '@/theme';
import { DemoBanner, GlobalDataSync, OfflineBanner, BottomTabBar } from '@/components/ui';
import { getRouteEngine } from '@/lib/native/routeEngine';

// Database path for persistent route engine (SQLite)
// FileSystem.documentDirectory returns a file:// URI, but SQLite needs a plain path
const getRouteDbPath = () => {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return null;
  // Strip file:// prefix if present for SQLite compatibility
  const plainPath = docDir.startsWith('file://') ? docDir.slice(7) : docDir;
  return `${plainPath}routes.db`;
};

// Suppress Reanimated strict mode warnings from Victory Native charts
// These occur because Victory uses shared values during render (known library behavior)
configureReanimatedLogger({ level: ReanimatedLogLevel.error, strict: false });

// Configure MapLibre to only log errors (suppress info/warning spam)
let mapLibreLoggerConfigured = false;
function configureMapLibreLogger() {
  if (mapLibreLoggerConfigured) return;
  try {
    MapLibreLogger.setLogLevel('error');
    mapLibreLoggerConfigured = true;
  } catch (error) {
    if (__DEV__) {
      console.warn('[MapLibre] Failed to configure logger:', error);
    }
  }
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const routeParts = useSegments();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const expandRange = useSyncDateRange((s) => s.expandRange);

  // Initialize Rust route engine with persistent storage when authenticated
  // Data persists in SQLite - GPS tracks, routes, sections load instantly
  // TODO: Add user-facing error notification when engine init fails
  useEffect(() => {
    if (isAuthenticated) {
      const engine = getRouteEngine();
      if (engine) {
        const dbPath = getRouteDbPath();
        if (!dbPath) {
          if (__DEV__) {
            console.warn('[RouteEngine] Cannot initialize - document directory not available.');
          }
          return;
        }

        const tryInit = (attempt: number) => {
          const success = engine.initWithPath(dbPath);
          if (success) {
            if (__DEV__) {
              console.log(
                `[RouteEngine] Initialized with persistent storage: ${engine.getActivityCount()} cached activities`
              );
            }
            // Set name translations for auto-generated route/section names
            const routeWord = i18n.t('routes.routeWord');
            const sectionWord = i18n.t('routes.sectionWord');
            engine.setNameTranslations(routeWord, sectionWord);
            // Initialize SyncDateRangeStore from engine's actual cached data
            const stats = engine.getStats();
            if (stats?.oldestDate && stats?.newestDate) {
              const oldestDateStr = formatLocalDate(new Date(Number(stats.oldestDate) * 1000));
              const newestDateStr = formatLocalDate(new Date(Number(stats.newestDate) * 1000));
              expandRange(oldestDateStr, newestDateStr);
              if (__DEV__) {
                console.log(
                  `[SyncDateRange] Initialized from engine: ${oldestDateStr} - ${newestDateStr}`
                );
              }
            }
          } else if (attempt < 2) {
            // Retry once after delay — handles transient FS issues on first launch
            if (__DEV__) {
              console.warn(
                `[RouteEngine] Init attempt ${attempt + 1} failed, retrying in 500ms...`
              );
            }
            setTimeout(() => tryInit(attempt + 1), 500);
          } else {
            if (__DEV__) {
              console.warn(
                `[RouteEngine] Persistent init failed after ${attempt + 1} attempts for path: ${dbPath}`
              );
            }
          }
        };

        tryInit(0);
      }
    }
  }, [isAuthenticated, expandRange]);

  // Reset infinite activities query when the date rolls over while backgrounded.
  // initialPageParam is computed at render time with today's date, but the feed tab
  // stays mounted (enableFreeze). If the app was opened yesterday, refetch() would
  // still query with yesterday's date, missing today's activities.
  const lastForegroundDateRef = useRef(formatLocalDate(new Date()));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const today = formatLocalDate(new Date());
        if (today !== lastForegroundDateRef.current) {
          lastForegroundDateRef.current = today;
          queryClient.resetQueries({ queryKey: ['activities-infinite'] });
        }
      }
    });
    return () => sub.remove();
  }, []);

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
      <View
        testID="auth-loading"
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: darkColors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <View style={{ flex: 1 }}>{children}</View>;
}

// Set to true when capturing screenshots (hides status bar)
const SCREENSHOT_MODE = __DEV__ && false;

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  const initializeAuth = useAuthStore((state) => state.initialize);

  // Initialize theme, auth, sport preference, HR zones, route settings, and i18n on app start
  useEffect(() => {
    async function initialize() {
      // Configure MapLibre logger early (safe to do now that native modules are loaded)
      configureMapLibreLogger();

      // Initialize language first to get the saved locale
      const savedLocale = await initializeLanguage();
      // Then initialize i18n with the saved locale
      await initializeI18n(savedLocale);
      // Initialize other providers in parallel
      // Dashboard preferences uses 'Cycling' fallback if sport preference isn't loaded yet
      await Promise.all([
        initializeTheme(),
        initializeAuth(),
        initializeSportPreference(),
        initializeUnitPreference(),
        initializeHRZones(),
        initializeRouteSettings(),
        initializeSupersededSections(),
        initializeDisabledSections(),
        initializeDashboardPreferences(), // Uses stored prefs or defaults to Cycling
        initializeDebugStore(),
      ]);
    }
    initialize().finally(() => setAppReady(true));
  }, [initializeAuth]);

  // Show minimal loading while initializing
  if (!appReady) {
    return (
      <View
        testID="app-loading"
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: darkColors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <NetworkProvider>
          <TopSafeAreaProvider>
            <MapPreferencesProvider>
              <PaperProvider theme={theme}>
                <StatusBar
                  style={colorScheme === 'dark' ? 'light' : 'dark'}
                  translucent={Platform.OS === 'ios'}
                  hidden={SCREENSHOT_MODE}
                  animated
                />
                <AuthGate>
                  <OfflineBanner />
                  <GlobalDataSync />
                  <DemoBanner />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      // iOS: Use default animation for native feel with gesture support
                      // Android: Slide from right for Material Design
                      animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
                      // Enable swipe-back gesture on both platforms
                      gestureEnabled: true,
                      gestureDirection: 'horizontal',
                      // iOS: Blur effect for any translucent headers
                      headerBlurEffect: Platform.OS === 'ios' ? 'prominent' : undefined,
                      headerTransparent: Platform.OS === 'ios',
                    }}
                  >
                    {/* Tabs group - no animation, instant switching */}
                    <Stack.Screen
                      name="(tabs)"
                      options={{
                        animation: 'none',
                      }}
                    />
                  </Stack>
                  <BottomTabBar />
                </AuthGate>
              </PaperProvider>
            </MapPreferencesProvider>
          </TopSafeAreaProvider>
        </NetworkProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
