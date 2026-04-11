// Enable screen freezing BEFORE any other imports
// This prevents inactive screens from re-rendering during navigation
import { enableFreeze } from 'react-native-screens';
enableFreeze(true);

import { LogBox } from 'react-native';
if (!__DEV__) {
  // Keep production logs quieter without hiding warnings while developing.
  LogBox.ignoreLogs(['Require cycle:', 'Sending `onAnimatedValueUpdate`']);
}

import { useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider, Text } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { Alert, AppState, View, ActivityIndicator, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import MapLibre, { Logger as MapLibreLogger } from '@maplibre/maplibre-react-native';
import {
  QueryProvider,
  queryClient,
  MapPreferencesProvider,
  NetworkProvider,
  TopSafeAreaProvider,
  initializeTheme,
  useResolvedColorScheme,
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
  initializeTileCacheStore,
  initializeWhatsNewStore,
  initializeInsightsStore,
  initializeRecordingPreferences,
  initializeUploadPermission,
  initializeNotificationPreferences,
  initializeNotificationPrompt,
  useSyncDateRange,
  useEngineStatus,
} from '@/providers';
import { isHeatmapEnabled } from '@/providers/RouteSettingsStore';
import { formatLocalDate } from '@/lib';
import { initializeI18n, i18n } from '@/i18n';
import { lightTheme, darkTheme, colors, darkColors } from '@/theme';
import {
  DemoBanner,
  GlobalDataSync,
  OfflineBanner,
  EngineInitBanner,
  BottomTabBar,
  GlobalErrorBoundary,
  WhatsNewModal,
  TourReturnPill,
} from '@/components/ui';
import { useUploadQueueProcessor } from '@/hooks/recording/useUploadQueueProcessor';
import { useRouteReoptimization } from '@/hooks/routes/useRouteReoptimization';
import { getRouteEngine, getRouteDbPath } from '@/lib/native/routeEngine';
import {
  migrateSettingsToSqlite,
  onAppBackground,
  onAppForeground,
  initWebdavConfig,
} from '@/lib/backup';
import {
  initializeNotifications,
  setupNotificationResponseHandler,
  hasNotificationPermission,
} from '@/lib/notifications/notificationService';

// Register background insight task at module scope (required by TaskManager)
import '@/lib/notifications/backgroundInsightTask';
import { registerBackgroundNotificationTask } from '@/lib/notifications/backgroundInsightTask';

// Suppress Reanimated strict mode warnings from Victory Native charts
// These occur because Victory uses shared values during render (known library behavior)
configureReanimatedLogger({ level: ReanimatedLogLevel.error, strict: false });

// Configure MapLibre to only log errors, with HTTP 404s downgraded to warnings
// (prevents red screen in dev mode from transient tile/font 404s)
let mapLibreLoggerConfigured = false;
function configureMapLibreLogger() {
  if (mapLibreLoggerConfigured) return;
  try {
    MapLibreLogger.setLogLevel('error');
    MapLibreLogger.setLogCallback((log: { message: string; level: string; tag?: string }) => {
      if (
        log.level === 'error' &&
        (log.tag === 'Mbgl-HttpRequest' ||
          log.message.includes('404') ||
          log.message.includes('not found') ||
          log.message.includes('Unable to resolve host') ||
          log.message.includes('Failed to load tile'))
      ) {
        if (__DEV__) {
          console.warn('MapLibre HTTP warning:', log.message);
        }
        return true;
      }
      return false;
    });
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
  const initializeRange = useSyncDateRange((s) => s.initializeRange);

  // Process queued uploads on network restore / app foreground
  useUploadQueueProcessor();

  // Trigger route re-detection when sync date range expands
  useRouteReoptimization();

  // Initialize Rust route engine with persistent storage when authenticated
  // Data persists in SQLite - GPS tracks, routes, sections load instantly
  const setEngineInitFailed = useEngineStatus((s) => s.setInitFailed);
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
            // Enable/disable heatmap tile generation based on setting
            if (isHeatmapEnabled()) {
              engine.enableHeatmapTiles();
            } else {
              engine.disableHeatmapTiles();
            }
            // Migrate AsyncStorage preferences to SQLite (one-time, idempotent)
            migrateSettingsToSqlite().catch(() => {});
            // Load WebDAV credentials into memory cache
            initWebdavConfig().catch(() => {});
            // Write athlete ID to SQLite for backup cross-athlete protection
            const athleteId = useAuthStore.getState().athleteId;
            if (athleteId) {
              engine.setSetting('__athlete_id', athleteId);
            }
            // Initialize SyncDateRangeStore from engine's actual cached data
            const stats = engine.getStats();
            if (stats?.oldestDate && stats?.newestDate) {
              const oldestDateStr = formatLocalDate(new Date(Number(stats.oldestDate) * 1000));
              const newestDateStr = formatLocalDate(new Date(Number(stats.newestDate) * 1000));
              initializeRange(oldestDateStr, newestDateStr);
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
            setEngineInitFailed(true);
          }
        };

        tryInit(0);
      }
    }
  }, [isAuthenticated, initializeRange, setEngineInitFailed]);

  // Reset infinite activities query when the date rolls over while backgrounded.
  // initialPageParam is computed at render time with today's date, but the feed tab
  // stays mounted (enableFreeze). If the app was opened yesterday, refetch() would
  // still query with yesterday's date, missing today's activities.
  const lastForegroundDateRef = useRef(formatLocalDate(new Date()));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        onAppBackground();
      }
      if (state === 'active') {
        onAppForeground();
        const today = formatLocalDate(new Date());
        if (today !== lastForegroundDateRef.current) {
          lastForegroundDateRef.current = today;
          queryClient.resetQueries({ queryKey: ['activities-infinite'] });
        }

        // Sync notification state: if OS permission was revoked while backgrounded,
        // disable notifications in the app store and unregister the push token
        const {
          getNotificationPreferences,
          useNotificationPreferences,
        } = require('@/providers/NotificationPreferencesStore');
        const prefs = getNotificationPreferences();
        if (prefs.enabled) {
          hasNotificationPermission().then((granted) => {
            if (!granted) {
              useNotificationPreferences.getState().setEnabled(false);
            }
          });
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
      // Check for athlete ID mismatch (restored backup from different account)
      const engine = getRouteEngine();
      const backupAthleteId = engine?.getSetting('__athlete_id');
      const currentAthleteId = useAuthStore.getState().athleteId;
      if (
        backupAthleteId &&
        currentAthleteId &&
        backupAthleteId !== currentAthleteId &&
        engine?.getActivityCount()
      ) {
        Alert.alert(
          i18n.t('backup.differentAccount', {
            defaultValue: 'Different Account',
          }),
          i18n.t('backup.differentAccountMessage', {
            defaultValue:
              'The restored data belongs to a different account. Clear data and sync fresh for this account?',
          }),
          [
            {
              text: i18n.t('common.cancel'),
              style: 'cancel',
              onPress: () => {
                // Sign out — return to login
                useAuthStore.getState().clearCredentials();
              },
            },
            {
              text: i18n.t('backup.clearAndSync', { defaultValue: 'Clear & Sync' }),
              style: 'destructive',
              onPress: async () => {
                engine?.clear();
                engine?.setSetting('__athlete_id', currentAthleteId);
                router.replace('/' as Href);
              },
            },
          ]
        );
        return;
      }
      // Update athlete ID for this account
      if (currentAthleteId && engine) {
        engine.setSetting('__athlete_id', currentAthleteId);
      }
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
  const [startupError, setStartupError] = useState<string | null>(null);
  const colorScheme = useResolvedColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  const initializeAuth = useAuthStore((state) => state.initialize);

  // Initialize theme, auth, sport preference, HR zones, route settings, and i18n on app start
  useEffect(() => {
    async function initialize() {
      try {
        // Configure MapLibre logger early (safe to do now that native modules are loaded)
        configureMapLibreLogger();

        // Initialize language first to get the saved locale
        const savedLocale = await initializeLanguage();
        // Then initialize i18n with the saved locale
        await initializeI18n(savedLocale);
        // Initialize other providers in parallel
        // Dashboard preferences uses 'Cycling' fallback if sport preference isn't loaded yet
        const results = await Promise.allSettled([
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
          initializeTileCacheStore(),
          initializeWhatsNewStore(),
          initializeInsightsStore(),
          initializeRecordingPreferences(),
          initializeUploadPermission(),
          initializeNotificationPreferences(),
          initializeNotificationPrompt(),
        ]);

        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length > 0) {
          const firstError = failed[0] as PromiseRejectedResult;
          const message =
            firstError.reason instanceof Error
              ? firstError.reason.message
              : String(firstError.reason ?? 'Unknown startup error');
          setStartupError(message);
          if (__DEV__) {
            console.warn(
              `[AppInit] ${failed.length} initializer(s) failed. First error: ${message}`
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown startup error';
        setStartupError(message);
        if (__DEV__) {
          console.error('[AppInit] Fatal initialization error:', error);
        }
      } finally {
        setAppReady(true);
      }
    }
    initialize();
  }, [initializeAuth]);

  // Set up notification handlers once on mount
  useEffect(() => {
    initializeNotifications();
    registerBackgroundNotificationTask();
    const subscription = setupNotificationResponseHandler();
    return () => subscription.remove();
  }, []);

  // Re-register push token on app open (refreshes TTL on server)
  // Also retry any failed unregister from a previous session
  useEffect(() => {
    if (!appReady) return;
    const {
      getNotificationPreferences,
      retryPendingUnregister,
    } = require('@/providers/NotificationPreferencesStore');
    const { useAuthStore: authStore } = require('@/providers/AuthStore');
    const prefs = getNotificationPreferences();
    const { athleteId, isDemoMode: demo } = authStore.getState();
    if (prefs.enabled && athleteId && !demo) {
      const { registerPushToken } = require('@/lib/notifications/pushTokenRegistration');
      registerPushToken(athleteId);
    } else if (!prefs.enabled && prefs.pendingUnregister && athleteId) {
      retryPendingUnregister(athleteId);
    }
  }, [appReady]);

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
    <GlobalErrorBoundary>
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
                    {startupError ? (
                      <View
                        style={{
                          backgroundColor: colorScheme === 'dark' ? '#3F2A17' : '#FEF3C7',
                          borderBottomWidth: 1,
                          borderBottomColor: colorScheme === 'dark' ? '#92400E' : '#F59E0B',
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ActivityIndicator size="small" color="#F59E0B" />
                          <Text
                            style={{
                              flex: 1,
                              color: colorScheme === 'dark' ? '#FDE68A' : '#92400E',
                              fontSize: 13,
                              lineHeight: 18,
                            }}
                          >
                            Startup completed with errors. Some features may be unavailable.
                          </Text>
                        </View>
                        {__DEV__ ? (
                          <Text
                            style={{
                              marginTop: 4,
                              color: colorScheme === 'dark' ? '#FCD34D' : '#B45309',
                              fontSize: 12,
                            }}
                            numberOfLines={2}
                          >
                            {startupError}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    <OfflineBanner />
                    <EngineInitBanner />
                    <GlobalDataSync />
                    <DemoBanner />
                    <WhatsNewModal />
                    <TourReturnPill />
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
    </GlobalErrorBoundary>
  );
}
