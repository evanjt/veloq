// Enable screen freezing BEFORE any other imports
// This prevents inactive screens from re-rendering during navigation
import { enableFreeze } from 'react-native-screens';

import { LogBox, Alert, AppState, View, ActivityIndicator, Platform } from 'react-native';

import { installGlobalCrashHandler, setCrashScreen } from '@/shared/debug/crashLog';

import { useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider, Text } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import { pushCredentialsToEngine, useAuthStore } from '@/shared/app/AuthStore';
import { seedDemoEngine } from '@/shared/app/seedDemoEngine';
import { startElevationBackfillAfterUpdate } from '@/features/routes/lib/elevationBackfillTrigger';
import { startDetectorCutoverAfterUpdate } from '@/features/routes/lib/cutoverTrigger';
import { initializeSportPreference, initializeHRZones } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { updateWidgetSnapshot } from '@/features/home';
import { initializeInsightsStore } from '@/features/insights/store';
import { MapPreferencesProvider } from '@/features/maps/stores/MapPreferencesContext';
import { migrateTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';
import { initializeRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { initializeUploadPermission } from '@/features/recording/stores/UploadPermissionStore';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import {
  initializeRouteSettings,
  isHeatmapEnabled,
} from '@/features/routes/stores/RouteSettingsStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';
import { initializeNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initializeNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initializeSupportStore, useSupportStore } from '@/shared/app/SupportStore';
import { initializeWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { initializeLanguage } from '@/shared/app/LanguageStore';
import { NetworkProvider } from '@/shared/app/NetworkContext';
import { initializeTheme, useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import { TopSafeAreaProvider } from '@/shared/app/TopSafeAreaContext';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { QueryProvider, queryClient } from '@/shared/query/QueryProvider';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from '@/shared/query/queryKeys';
import { initializeI18n, i18n } from '@/i18n';
import { lightTheme, darkTheme, colors, darkColors, amberBanner } from '@/theme';
import {
  ShaderWarmup,
  OfflineBanner,
  SyncErrorBanner,
  BottomTabBar,
  GlobalErrorBoundary,
} from '@/shared/ui';
import { DemoBanner } from '@/shared/app/DemoBanner';
import { GlobalDataSync } from '@/shared/app/GlobalDataSync';
import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { WhatsNewModal, TourReturnPill } from '@/features/settings/components/whatsNew';
import { RecordingReturnPill } from '@/features/recording/components/RecordingReturnPill';
import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import { useRouteReoptimization } from '@/features/routes/hooks/useRouteReoptimization';
import { getRouteEngine, getRouteDbPath } from '@/shared/native/routeEngine';
import { rememberCachedAthleteId, migrateSettingsToSqlite } from '@/shared/storage';
import {
  onAppBackground,
  onAppForeground,
  initWebdavConfig,
} from '@/features/settings/lib/autobackup';
import {
  initializeNotifications,
  setupNotificationReceivedHandler,
  setupNotificationResponseHandler,
  handleInitialNotificationResponse,
  hasNotificationPermission,
} from '@/features/settings/lib/notificationService';

// Registers the background insight task at module scope (required by TaskManager)
import { registerBackgroundNotificationTask } from '@/features/insights/backgroundInsightTask';
enableFreeze(true);
if (!__DEV__) {
  // Keep production logs quieter without hiding warnings while developing.
  LogBox.ignoreLogs(['Require cycle:', 'Sending `onAnimatedValueUpdate`']);
}
installGlobalCrashHandler();

// Suppress Reanimated strict mode warnings from Victory Native charts
// These occur because Victory uses shared values during render (known library behavior)
configureReanimatedLogger({ level: ReanimatedLogLevel.error, strict: false });

function AuthGate({ children }: { children: React.ReactNode }) {
  const routeParts = useSegments();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const initializeRange = useSyncDateRange((s) => s.initializeRange);

  useEffect(() => {
    setCrashScreen(routeParts.join('/') || 'root');
  }, [routeParts]);

  // Process queued uploads on network restore / app foreground
  useUploadQueueProcessor();

  // Trigger route re-detection when sync date range expands
  useRouteReoptimization();

  // Initialize Rust route engine with persistent storage when authenticated
  // Data persists in SQLite - GPS tracks, routes, sections load instantly
  const setEngineInitFailed = useEngineStatus((s) => s.setInitFailed);
  const engineRetryNonce = useEngineStatus((s) => s.retryNonce);
  const markEngineReady = useEngineStatus((s) => s.markEngineReady);
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
          let success = engine.initWithPath(dbPath);
          let cachedAthleteId: string | undefined;
          if (success) {
            // Engine holds at most one identity's data at a time. If the cached
            // __athlete_id setting belongs to someone else (different real
            // account, or demo data left over after a force-quit), wipe and
            // re-init so the new identity starts from a clean slate.
            cachedAthleteId = engine.getSetting('__athlete_id');
            const credentialsAthleteId = useAuthStore.getState().athleteId;
            if (
              cachedAthleteId &&
              credentialsAthleteId &&
              cachedAthleteId !== credentialsAthleteId
            ) {
              if (__DEV__) {
                console.log(
                  `[RouteEngine] Identity mismatch (cached=${cachedAthleteId}, credentials=${credentialsAthleteId}) - wiping engine`
                );
              }
              engine.clear();
              success = engine.initWithPath(dbPath);
            }
          }
          if (success) {
            setEngineInitFailed(false);
            // Effects mounted below this one ran while the handle was null.
            // The bump is what lets them try again, the launch sync first.
            markEngineReady();
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
              rememberCachedAthleteId(athleteId).catch(() => {});
            } else if (cachedAthleteId) {
              // Installs from before the mirror existed only have the SQLite
              // setting. Seed the mirror so the login screen can still name
              // whose data is on disk once the engine is down.
              rememberCachedAthleteId(cachedAthleteId).catch(() => {});
            }
            // AuthStore.initialize() usually runs before the engine exists, so
            // its credential push was a no-op. Repeat it now the engine is up.
            pushCredentialsToEngine();
            // Demo mode reads the same tables as live mode, so the fixtures
            // have to be in SQLite before any screen queries the engine.
            if (useAuthStore.getState().isDemoMode) {
              seedDemoEngine();
            } else {
              // Tracks stored before elevation was fetched need a re-fetch;
              // the trigger keeps attempting each launch until nothing is
              // left to ask. Runs after the credential push so Rust has
              // something to authenticate with.
              startElevationBackfillAfterUpdate().catch(() => {});
              // A catalogue an older build cut stays until this runs; the
              // trigger declines while the backfill still owes fetches, so a
              // catalogue is never cut over a half-elevated library.
              startDetectorCutoverAfterUpdate().catch(() => {});
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
            // Retry once after delay - handles transient FS issues on first launch
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
  }, [isAuthenticated, initializeRange, setEngineInitFailed, engineRetryNonce, markEngineReady]);

  // Reset infinite activities query when the date rolls over while backgrounded.
  // initialPageParam is computed at render time with today's date, but the feed tab
  // stays mounted (enableFreeze). If the app was opened yesterday, refetch() would
  // still query with yesterday's date, missing today's activities.
  const lastForegroundDateRef = useRef(formatLocalDate(new Date()));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        onAppBackground();
        // Refresh the home-screen widget with the latest data while we have the
        // engine warm. No-op until the native widget module is built in.
        updateWidgetSnapshot();
      }
      if (state === 'active') {
        onAppForeground();
        const today = formatLocalDate(new Date());
        if (today !== lastForegroundDateRef.current) {
          lastForegroundDateRef.current = today;
          queryClient.resetQueries({
            queryKey: queryKeys.activities.infinite.all,
          });
        }

        // Sync notification state: if OS permission was revoked while backgrounded,
        // disable notifications in the app store and unregister the push token
        const {
          getNotificationPreferences,
          useNotificationPreferences,
        } = require('@/features/settings/stores/NotificationPreferencesStore');
        const prefs = getNotificationPreferences();
        if (prefs.enabled) {
          hasNotificationPermission().then((granted) => {
            if (!granted) {
              useNotificationPreferences.getState().setEnabled(false);
              return;
            }
            // Keep the server-side token registration (30-day TTL) fresh.
            // Throttled to once a day inside the helper.
            const athleteId = useAuthStore.getState().athleteId;
            if (athleteId) {
              const {
                refreshPushTokenRegistration,
              } = require('@/features/settings/lib/pushTokenRegistration');
              refreshPushTokenRegistration(athleteId).catch(() => {});
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
      // Defer navigation so Android finishes the current render pass before
      // the tab navigator is torn down. Without this delay, Android crashes
      // with NullPointerException in ViewGroup.dispatchGetDisplayList.
      const timer = setTimeout(() => {
        router.replace('/login' as Href);
      }, 100);
      return () => clearTimeout(timer);
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
                // Sign out - return to login
                useAuthStore.getState().clearCredentials();
              },
            },
            {
              text: i18n.t('backup.clearAndSync', {
                defaultValue: 'Clear & Sync',
              }),
              style: 'destructive',
              onPress: async () => {
                engine?.clear();
                engine?.setSetting('__athlete_id', currentAthleteId);
                await rememberCachedAthleteId(currentAthleteId);
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
        rememberCachedAthleteId(currentAthleteId).catch(() => {});
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
          initializeDashboardPreferences(), // Uses stored prefs or defaults to Cycling
          initializeDebugStore(),
          migrateTileCacheSettings(),
          initializeWhatsNewStore(),
          initializeInsightsStore(),
          initializeRecordingPreferences(),
          initializeUploadPermission(),
          initializeNotificationPreferences(),
          initializeNotificationPrompt(),
          initializeSupportStore(),
        ]);

        // One-time legacy purchaser detection: if user already had data
        // when the app went free, mark them so they see a different card
        const support = useSupportStore.getState();
        if (support.isLoaded && !support.isLegacyPurchaser) {
          try {
            const eng = getRouteEngine();
            if (eng && eng.getActivityCount() > 0) {
              support.setLegacyPurchaser();
            }
          } catch {
            // Engine not available yet - skip, will be a new user
          }
        }

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
    const receivedSub = setupNotificationReceivedHandler();
    const responseSub = setupNotificationResponseHandler();
    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  // Handle cold-start taps - addNotificationResponseReceivedListener misses
  // these on Android because it registers after JS has booted, but the tap
  // intent was already delivered. Gate on appReady so the router is mounted
  // when we call router.push.
  useEffect(() => {
    if (!appReady) return;
    handleInitialNotificationResponse();
  }, [appReady]);

  // Re-register push token on app open (refreshes TTL on server)
  // Also retry any failed unregister from a previous session
  useEffect(() => {
    if (!appReady) return;
    const {
      getNotificationPreferences,
      retryPendingUnregister,
    } = require('@/features/settings/stores/NotificationPreferencesStore');
    const { useAuthStore: authStore } = require('@/shared/app/AuthStore');
    const prefs = getNotificationPreferences();
    const { athleteId, isDemoMode: demo } = authStore.getState();
    if (prefs.enabled && athleteId && !demo) {
      const { registerPushToken } = require('@/features/settings/lib/pushTokenRegistration');
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
                    animated
                  />
                  <AuthGate>
                    {startupError ? (
                      <View
                        style={{
                          backgroundColor:
                            colorScheme === 'dark' ? amberBanner.dark.bg : amberBanner.light.bg,
                          borderBottomWidth: 1,
                          borderBottomColor:
                            colorScheme === 'dark'
                              ? amberBanner.dark.border
                              : amberBanner.light.border,
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <ActivityIndicator size="small" color="#F59E0B" />
                          <Text
                            style={{
                              flex: 1,
                              color:
                                colorScheme === 'dark'
                                  ? amberBanner.dark.text
                                  : amberBanner.light.text,
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
                              color:
                                colorScheme === 'dark'
                                  ? amberBanner.dark.subtext
                                  : amberBanner.light.subtext,
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
                    <SyncErrorBanner />
                    <EngineInitBanner />
                    <GlobalDataSync />
                    <DemoBanner />
                    <WhatsNewModal />
                    <TourReturnPill />
                    <RecordingReturnPill />
                    <ShaderWarmup />
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
                      {/* An active recording must not be swipeable away. The
                          back gesture runs in the same direction as the
                          slide-to-unlock track, so a stray palm swipe would
                          drop the rider out of the screen mid-ride. Leaving is
                          deliberate: stop the recording, or use the header. */}
                      <Stack.Screen
                        name="recording/[type]"
                        options={{
                          gestureEnabled: false,
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
