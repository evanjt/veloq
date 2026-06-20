// Enable screen freezing BEFORE any other imports
// This prevents inactive screens from re-rendering during navigation
import { enableFreeze } from 'react-native-screens';
enableFreeze(true);

import { LogBox } from 'react-native';
if (!__DEV__) {
  // Keep production logs quieter without hiding warnings while developing.
  LogBox.ignoreLogs(['Require cycle:', 'Sending `onAnimatedValueUpdate`']);
}

import { installGlobalCrashHandler, setCrashScreen } from '@/shared/debug/crashLog';
installGlobalCrashHandler();

import { useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider, Text } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import {
  Alert,
  AppState,
  View,
  ActivityIndicator,
  Platform,
  InteractionManager,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import MapLibre, { Logger as MapLibreLogger } from '@maplibre/maplibre-react-native';
import { useAuthStore } from '@/features/auth/store';
import { initializeSportPreference, initializeHRZones } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { updateWidgetSnapshot } from '@/features/home';
import { initializeInsightsStore } from '@/features/insights/store';
import { MapPreferencesProvider } from '@/features/maps/stores/MapPreferencesContext';
import { initializeTileCacheStore } from '@/features/maps/stores/TileCacheStore';
import { initializeRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { initializeUploadPermission } from '@/features/recording/stores/UploadPermissionStore';
import { initializeDisabledSections } from '@/features/routes/stores/DisabledSectionsStore';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { initializeRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { initializeSupersededSections } from '@/features/routes/stores/SupersededSectionsStore';
import { useSyncDateRange } from '@/features/routes/stores/SyncDateRangeStore';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';
import { initializeNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initializeNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initializeSupportStore, useSupportStore } from '@/features/settings/stores/SupportStore';
import { initializeWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { initializeLanguage } from '@/shared/app/LanguageStore';
import { NetworkProvider } from '@/shared/app/NetworkContext';
import { initializeTheme, useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import { TopSafeAreaProvider } from '@/shared/app/TopSafeAreaContext';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { QueryProvider, queryClient } from '@/shared/query/QueryProvider';
import {
  isHeatmapEnabled,
  getDetectionStrictness,
  getDetectionMethod,
} from '@/features/routes/stores/RouteSettingsStore';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from '@/shared/query/queryKeys';
import { initializeI18n, i18n } from '@/i18n';
import { lightTheme, darkTheme, colors, darkColors, amberBanner } from '@/theme';
import { ShaderWarmup, OfflineBanner, BottomTabBar, GlobalErrorBoundary } from '@/shared/ui';
import { DemoBanner } from './_components/DemoBanner';
import { GlobalDataSync } from './_components/GlobalDataSync';
import { EngineInitBanner } from './_components/EngineInitBanner';
import { WhatsNewModal, TourReturnPill } from '@/features/settings/components/whatsNew';
import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import { useRouteReoptimization } from '@/features/routes/hooks/useRouteReoptimization';
import {
  getRouteEngine,
  getRouteDbPath,
  applyDetectionPresetForMethod,
  getStrictnessFromValue,
} from '@/shared/native/routeEngine';
import { migrateSettingsToSqlite } from '@/shared/storage';
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

// Register background insight task at module scope (required by TaskManager)
import '@/features/insights/backgroundInsightTask';
import { registerBackgroundNotificationTask } from '@/features/insights/backgroundInsightTask';

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
          if (success) {
            // Engine holds at most one identity's data at a time. If the cached
            // __athlete_id setting belongs to someone else (different real
            // account, or demo data left over after a force-quit), wipe and
            // re-init so the new identity starts from a clean slate.
            const cachedAthleteId = engine.getSetting('__athlete_id');
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
            // Apply persisted detection strictness if not default
            const strictness = getDetectionStrictness();
            if (strictness !== 60) {
              applyDetectionPresetForMethod(
                getDetectionMethod(),
                getStrictnessFromValue(strictness)
              );
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
                // Sign out — return to login
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
            // Engine not available yet — skip, will be a new user
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

  // Handle cold-start taps — addNotificationResponseReceivedListener misses
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
    const { useAuthStore: authStore } = require('@/features/auth/store');
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
                    hidden={SCREENSHOT_MODE}
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
                    <EngineInitBanner />
                    <GlobalDataSync />
                    <DemoBanner />
                    <WhatsNewModal />
                    <TourReturnPill />
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
