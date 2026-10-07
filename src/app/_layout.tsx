// Enable screen freezing BEFORE any other imports
// This prevents inactive screens from re-rendering during navigation
import { enableFreeze } from 'react-native-screens';

import { LogBox, AppState, View, ActivityIndicator } from 'react-native';

import { installGlobalCrashHandler, setCrashScreen } from '@/shared/debug/crashLog';

import { useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import { isRetryableInit } from 'veloqrs';
import { reportFeedOpened } from '@/shared/native/feedSeen';

import { pushCredentialsToEngine, useAuthStore } from '@/shared/app/AuthStore';
import { seedDemoEngine } from '@/shared/app/seedDemoEngine';
import { handleAppBackground } from '@/shared/app/appBackground';
import {
  isHeatmapEnabled,
  MapPreferencesProvider,
  registerMapSurfaceReclaimer,
} from '@/features/maps';
import { useEngineStatus, useRouteReoptimization } from '@/features/routes';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { NetworkProvider } from '@/shared/app/NetworkContext';
import { useResolvedColorScheme } from '@/shared/app/ThemeProvider';
import { startMemoryPressureListener } from '@/shared/app/memoryPressure';
import {
  registerImageCacheReclaimer,
  registerQueryCacheReclaimer,
} from '@/shared/app/memoryReclaimers';
import { TopSafeAreaProvider } from '@/shared/app/TopSafeAreaContext';
import { QueryProvider, queryClient } from '@/shared/query/QueryProvider';
import {
  SCREEN_HEADERS,
  overMapHeaderTint,
  screenAnimation,
  sheetScreenOptions,
} from '@/shared/app/screenHeaders';
import {
  adoptOwnerlessRecordingBackup,
  adoptOwnerlessRecordings,
  settleOwnerlessAdoptions,
  RecordingTitle,
  resumeHeldRecordingForAthlete,
  RecordingReturnPill,
  installRecordingSession,
  useUploadQueueProcessor,
} from '@/features/recording';
import { formatLocalDate } from '@/shared/format/format';
import { seedSyncRange } from '@/shared/app/syncRangeSeed';
import { queryKeys } from '@/shared/query/queryKeys';
import { i18n } from '@/i18n';
import { lightTheme, darkTheme, colors, darkColors, typography } from '@/theme';
import {
  ShaderWarmup,
  OfflineBanner,
  SyncErrorBanner,
  TrackFetchNotice,
  BottomTabBar,
  GlobalErrorBoundary,
} from '@/shared/ui';
import { DemoBanner } from '@/shared/app/DemoBanner';
import { GlobalDataSync } from '@/shared/app/GlobalDataSync';
import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { WhatsNewModal, TourReturnPill } from '@/features/settings/components/whatsNew';
import {
  captureQuarantineReport,
  LibraryRebuiltNotice,
  applyHeldImport,
  applyPlatformRecord,
  restorePromptDue,
  backupIsFound,
  RestorePromptSheet,
  onAppForeground,
  initWebdavConfig,
} from '@/features/settings';
import { getEngine, getRouteDbPath } from '@/shared/native/engine';
import { engineErrorTag } from '@/shared/native/engineError';
import { reconsiderFallback } from '@/shared/native/eventFallback';
import { readLibraryCount } from '@/shared/native/libraryCount';
import {
  runEngineInit,
  startEngineInitRun,
  type EngineInitAttempt,
} from '@/shared/app/engineInitRun';
import {
  rememberCachedAthleteId,
  rememberStoredActivityCount,
  migrateSettingsToSqlite,
  wipeLibrary,
} from '@/shared/storage';
import {
  promptAccountMismatch,
  launchIdentityAction,
  completeLaunchIdentity,
  getCachedAthleteId,
} from '@/features/auth';
import {
  initializeNotifications,
  setupNotificationReceivedHandler,
  setupNotificationResponseHandler,
  handleInitialNotificationResponse,
  hasNotificationPermission,
} from '@/features/settings/lib/notificationService';

// Registers the background insight task at module scope (required by TaskManager)
import { registerBackgroundNotificationTask } from '@/features/insights';
import { debug } from '@/shared/debug/debug';
import { initializeApp } from '@/shared/app/launch';
import { releaseSplash } from '@/shared/app/splash';
import { openLibrary } from '@/shared/storage/routeDbLocation';
import { StartupErrorBanner, type StartupArea } from '@/shared/ui/StartupErrorBanner';

const log = debug.create('RootLayout');
enableFreeze(true);
if (!__DEV__) {
  // Keep production logs quieter without hiding warnings while developing.
  LogBox.ignoreLogs(['Require cycle:', 'Sending `onAnimatedValueUpdate`']);
}

installGlobalCrashHandler();

// Suppress Reanimated strict mode warnings from Victory Native charts
// These occur because Victory uses shared values during render (known library behavior)
configureReanimatedLogger({ level: ReanimatedLogLevel.error, strict: false });

export function AuthGate({ children }: { children: React.ReactNode }) {
  const routeParts = useSegments();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  // Where this launch's library stands for the redirect off the login screen:
  // `settled` once its identity is known, `unopened` once there is no library
  // to settle (no engine, no path, or an init that gave up). Only `pending`
  // holds the athlete on the login screen.
  const launchIdentityRef = useRef<'pending' | 'settled' | 'unopened'>('pending');
  const [identitySettledRun, setIdentitySettledRun] = useState(0);
  const athleteId = useAuthStore((s) => s.athleteId);
  const heldRideChecked = useRef<string | null>(null);
  const initializeRange = useSyncDateRange((s) => s.initializeRange);

  useEffect(() => {
    setCrashScreen(routeParts.join('/') || 'root');
  }, [routeParts]);

  useEffect(() => {
    const reclaimers = [
      registerQueryCacheReclaimer(),
      registerImageCacheReclaimer(),
      registerMapSurfaceReclaimer(),
    ];
    const stop = startMemoryPressureListener();
    return () => {
      stop();
      for (const off of reclaimers) off();
    };
  }, []);

  // Process queued uploads on network restore / app foreground
  useUploadQueueProcessor();

  // Trigger route re-detection when sync date range expands
  useRouteReoptimization();

  // Initialize Rust route engine with persistent storage when authenticated
  // Data persists in SQLite - GPS tracks, routes, sections load instantly
  const setEngineInitFailed = useEngineStatus((s) => s.setInitFailed);
  const setEngineInitFailureReason = useEngineStatus((s) => s.setInitFailureReason);
  const engineRetryNonce = useEngineStatus((s) => s.retryNonce);
  const markEngineReady = useEngineStatus((s) => s.markEngineReady);
  const [restorePromptVisible, setRestorePromptVisible] = useState(false);
  useEffect(() => {
    const run = startEngineInitRun();
    launchIdentityRef.current = 'pending';
    const settleLaunchIdentity = (state: 'settled' | 'unopened') => {
      launchIdentityRef.current = state;
      setIdentitySettledRun((previous) => previous + 1);
    };
    if (isAuthenticated) {
      const engine = getEngine();
      if (!engine) {
        settleLaunchIdentity('unopened');
      } else {
        const dbPath = getRouteDbPath();
        if (!dbPath) {
          if (__DEV__) {
            console.warn('[Engine] Cannot initialize - document directory not available.');
          }
          settleLaunchIdentity('unopened');
          return () => run.cancel();
        }

        /**
         * Everything launch does once the library on disk is known to belong to
         * the athlete who signed in. The launch sync, the elevation backfill and
         * the detector cutover all write with their credentials, so none of it
         * may run before that is settled. `completeLaunchIdentity` is the gate.
         */
        const afterInit = (cachedAthleteId?: string) => {
          // A chain the athlete abandoned by tapping retry must not reach this
          // block: two of them ask the backfill and cutover questions twice.
          if (!run.live) return;
          setEngineInitFailed(false);
          setEngineInitFailureReason(null);
          // Effects mounted below this one ran while the handle was null.
          // The bump is what lets them try again, the launch sync first.
          markEngineReady();
          // A cold launch emits no `active` change, so the open is reported here.
          reportFeedOpened();
          reconsiderFallback();
          // The name translations, the heatmap toggle, the athlete id the
          // backup's cross-athlete guard reads, and the stats the date range
          // opens from, in one call. These were five round trips through the
          // binding before first paint, and each one a place a sync page write
          // could hold the launch behind the engine's write lock.
          const athleteId = useAuthStore.getState().athleteId;
          let stats: ReturnType<typeof engine.launchData>;
          try {
            stats = engine.launchData({
              routeWord: i18n.t('routes.routeWord'),
              sectionWord: i18n.t('routes.sectionWord'),
              athleteId,
              heatmapEnabled: isHeatmapEnabled(),
            });
          } catch (error) {
            console.warn('[Engine] Launch data failed:', engineErrorTag(error) ?? error);
          }
          settleLaunchIdentity('settled');
          // No count is not a count of 0: the login screen reads 0 in this mirror
          // as no library on the device, so a failed read leaves the last one.
          if (stats) rememberStoredActivityCount(stats.libraryCount).catch(() => {});
          if (__DEV__) {
            log.log(
              `[Engine] Initialized with persistent storage: ${stats?.activityCount ?? 0} cached activities`
            );
          }
          // Migrate AsyncStorage preferences to SQLite (one-time, idempotent)
          migrateSettingsToSqlite().catch(() => {});
          // Load WebDAV credentials into memory cache
          initWebdavConfig().catch(() => {});
          if (athleteId) {
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
            // A phone set up from a device backup has the record zip and no
            // library. The count is read before the launch sync stores any.
            // With no zip to apply, or one the engine refused, the library
            // stays empty, so the athlete is offered the other routes once.
            // A backup picked before signing in goes first, and answers both.
            const launchCount = stats?.activityCount ?? 0;
            applyHeldImport(i18n.t)
              .then(() => applyPlatformRecord(launchCount, i18n.t))
              .then(async () => {
                if (launchCount > 0 || !run.live) return;
                const found = await backupIsFound();
                if (run.live && restorePromptDue(launchCount, found)) setRestorePromptVisible(true);
              })
              .catch(() => {});
          }
          // Initialize SyncDateRangeStore from engine's actual cached data
          if (seedSyncRange(stats, initializeRange) && __DEV__) {
            log.log(
              `[SyncDateRange] Initialized from engine window: ${stats?.activityWindowOldest}`
            );
          }
        };

        const attemptInit = async (attempt: number): Promise<EngineInitAttempt> => {
          if (openLibrary(engine, dbPath)) {
            captureQuarantineReport();
            // An older build's unowned crash backup goes to whoever this library
            // belongs to, read before the identity check below can wipe it.
            await adoptOwnerlessRecordingBackup(getCachedAthleteId);
            // The same for the rides an older build kept in AsyncStorage.
            await adoptOwnerlessRecordings(getCachedAthleteId);
            // Engine holds at most one identity's data at a time. If the cached
            // __athlete_id setting belongs to someone else (different real
            // account, or demo data left over after a force-quit), wipe and
            // re-init so the new identity starts from a clean slate.
            // A failed read is not an absent identity: proceeding on it would sync
            // one athlete's credentials into a library that may be another's.
            let cachedAthleteId: string | undefined;
            try {
              cachedAthleteId = engine.getSetting('__athlete_id');
            } catch {
              return 'failed';
            }
            const credentialsAthleteId = useAuthStore.getState().athleteId;
            const activityCount = readLibraryCount(engine);
            const action = launchIdentityAction(
              cachedAthleteId,
              credentialsAthleteId,
              activityCount
            );
            if (action !== 'proceed' && __DEV__) {
              log.log(
                `[Engine] Identity mismatch (cached=${cachedAthleteId}, credentials=${credentialsAthleteId}), ${action}`
              );
            }
            // A restored library is the athlete's only copy, so it is never
            // wiped without being asked, and nothing launch does runs until the
            // question is answered. An empty engine has nothing to ask about and
            // takes the new identity as it stands.
            const settled = await completeLaunchIdentity(action, {
              // The wipe runs on a Rust thread, so the re-open has to follow it
              // rather than race it. It takes the other athlete's files with
              // the tables, the decisions zip among them.
              wipe: wipeLibrary,
              reopen: () => {
                const opened = openLibrary(engine, dbPath);
                if (opened) captureQuarantineReport();
                return opened;
              },
              ask: () =>
                promptAccountMismatch({
                  storedAthleteId: cachedAthleteId as string,
                  credentialsAthleteId: credentialsAthleteId as string,
                  activityCount,
                }),
              // A wipe took the cached id with it, so only an identity that
              // was already settled has one left to seed the mirror from.
              proceed: () => afterInit(action === 'proceed' ? cachedAthleteId : undefined),
            });
            // `ask-first` is waiting on the athlete rather than failing, and
            // everything else that did not settle failed to re-open, which is
            // the same condition the retry is for.
            if (action === 'ask-first') return 'waiting';
            if (settled) return 'settled';
          }
          if (__DEV__) {
            console.warn(`[Engine] Init attempt ${attempt + 1} failed`);
          }
          return 'failed';
        };

        // Only a held file lifts on its own: a database from a newer build and
        // a directory nothing can be written to answer the same way in 500 ms,
        // so the athlete waits a second to be told what they could have been
        // told at once.
        void runEngineInit(run, {
          attempt: attemptInit,
          retryable: () => isRetryableInit(engine.initOutcome()),
          giveUp: () => {
            if (__DEV__) {
              console.warn(`[Engine] Persistent init failed for path: ${dbPath}`);
            }
            setEngineInitFailureReason(engine.initOutcome());
            setEngineInitFailed(true);
            // Nothing will settle this library's identity now, so the athlete
            // is taken to the init banner rather than held here.
            settleLaunchIdentity('unopened');
          },
        });
      }
    }
    return () => run.cancel();
  }, [
    isAuthenticated,
    initializeRange,
    setEngineInitFailed,
    setEngineInitFailureReason,
    engineRetryNonce,
    markEngineReady,
  ]);

  // Reset infinite activities query when the date rolls over while backgrounded.
  // initialPageParam is computed at render time with today's date, but the feed tab
  // stays mounted (enableFreeze). If the app was opened yesterday, refetch() would
  // still query with yesterday's date, missing today's activities.
  const lastForegroundDateRef = useRef(formatLocalDate(new Date()));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        handleAppBackground();
      }
      if (state === 'active') {
        onAppForeground();
        reportFeedOpened();
        const today = formatLocalDate(new Date());
        if (today !== lastForegroundDateRef.current) {
          lastForegroundDateRef.current = today;
          queryClient.resetQueries({
            queryKey: queryKeys.activities.infinite.all,
          });
        }

        // Sync notification state: if OS permission was revoked while backgrounded,
        // disable notifications in the app store and unregister the push token
        const { getNotificationPreferences, useNotificationPreferences } =
          require('@/features/settings') as typeof import('@/features/settings');
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
              const { refreshPushTokenRegistration } =
                require('@/features/settings') as typeof import('@/features/settings');
              refreshPushTokenRegistration(athleteId).catch(() => {});
            }
          });
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isLoading) return undefined;

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
      if (launchIdentityRef.current === 'pending') return undefined;
      const engine = getEngine();
      const currentAthleteId = useAuthStore.getState().athleteId;
      // Update athlete ID for this account, only on a library whose identity
      // was settled: an unopened one has nobody to stamp it for.
      if (launchIdentityRef.current === 'settled' && currentAthleteId && engine) {
        let stampedId: string | undefined;
        try {
          stampedId = engine.getSetting('__athlete_id');
        } catch {
          // An unreadable identity is not stamped over: the next launch reads it again.
          router.replace('/' as Href);
          return undefined;
        }
        if (stampedId !== currentAthleteId) {
          // The identity changes only once the adoptions are durably ended; a
          // failed marker write leaves it as it was for the next launch to judge.
          let cancelled = false;
          settleOwnerlessAdoptions().then(
            () => {
              if (cancelled) return;
              engine.setSetting('__athlete_id', currentAthleteId);
              rememberCachedAthleteId(currentAthleteId).catch(() => {});
              router.replace('/' as Href);
            },
            () => {
              if (!cancelled) router.replace('/' as Href);
            }
          );
          return () => {
            cancelled = true;
          };
        }
        engine.setSetting('__athlete_id', currentAthleteId);
        rememberCachedAthleteId(currentAthleteId).catch(() => {});
      }
      // Authenticated but on login screen - redirect to main app
      router.replace('/' as Href);
    }
    return undefined;
  }, [isAuthenticated, isLoading, identitySettledRun, routeParts, router]);

  useEffect(() => {
    if (!isAuthenticated || !athleteId) {
      heldRideChecked.current = null;
      return;
    }
    if (routeParts.includes('login' as never) || heldRideChecked.current === athleteId) return;
    heldRideChecked.current = athleteId;
    void resumeHeldRecordingForAthlete(athleteId).then((route) => {
      if (route && useAuthStore.getState().athleteId === athleteId) router.replace(route as Href);
    });
  }, [athleteId, isAuthenticated, routeParts, router]);

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

  return (
    <View style={{ flex: 1 }}>
      {children}
      <RestorePromptSheet
        visible={restorePromptVisible}
        onClose={() => setRestorePromptVisible(false)}
      />
    </View>
  );
}

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const [startupError, setStartupError] = useState<StartupArea[] | null>(null);
  const colorScheme = useResolvedColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = isDark ? darkTheme : lightTheme;
  const { t } = useTranslation();

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const areas = await initializeApp().catch((error: unknown): StartupArea[] => {
          console.warn('[AppInit] launch rejected:', error);
          return ['other'];
        });
        if (!mounted) return;
        if (areas) setStartupError(areas);
      } finally {
        if (mounted) setAppReady(true);
      }
    };
    void initialize();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!appReady) return;
    releaseSplash();
  }, [appReady]);

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

  // The recording session belongs to the store, not to the recording screen, so
  // leaving that screen mid-ride no longer stops the GPS.
  useEffect(() => installRecordingSession(), []);

  // Re-register push token on app open (refreshes TTL on server)
  // Also retry any failed unregister from a previous session
  useEffect(() => {
    if (!appReady) return;
    (
      require('@/features/settings') as typeof import('@/features/settings')
    ).reconcilePushRegistrationOnLaunch();
  }, [appReady]);

  // Show minimal loading while initializing
  if (!appReady) return null;

  return (
    <GlobalErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryProvider>
          <NetworkProvider>
            <TopSafeAreaProvider startupErrorShown={startupError !== null}>
              <MapPreferencesProvider>
                <PaperProvider theme={theme}>
                  <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} animated />
                  <AuthGate>
                    {startupError ? (
                      <StartupErrorBanner
                        areas={startupError}
                        onDismiss={() => setStartupError(null)}
                      />
                    ) : null}
                    <OfflineBanner />
                    <SyncErrorBanner />
                    <TrackFetchNotice />
                    <EngineInitBanner />
                    <GlobalDataSync />
                    <DemoBanner />
                    <LibraryRebuiltNotice />
                    <WhatsNewModal />
                    <TourReturnPill />
                    <RecordingReturnPill />
                    <ShaderWarmup />
                    <Stack
                      screenOptions={{
                        // Enable swipe-back gesture on both platforms
                        gestureEnabled: true,
                        gestureDirection: 'horizontal',
                        headerStyle: {
                          backgroundColor: isDark ? darkColors.surface : colors.surface,
                        },
                        headerTintColor: isDark ? darkColors.textPrimary : colors.textPrimary,
                        headerTitleStyle: { fontSize: typography.cardTitle.fontSize },
                      }}
                    >
                      {Object.entries(SCREEN_HEADERS).map(([name, header]) => (
                        <Stack.Screen
                          key={name}
                          name={name}
                          options={{
                            headerShown: header !== null,
                            title: header?.title ?? (header?.titleKey ? t(header.titleKey) : ''),
                            animation: screenAnimation(name),
                            // An active recording must not be swipeable away. The
                            // back gesture runs in the same direction as the
                            // slide-to-unlock track, so a stray palm swipe would
                            // drop the rider out of the screen mid-ride. The screen has
                            // no header: during a ride leaving is the stop flow, and
                            // before one starts the close control is the way off.
                            gestureEnabled: name !== 'recording/[type]',
                            ...sheetScreenOptions(name),
                            ...(header?.overMap && {
                              headerTransparent: true,
                              headerTitle: '',
                              headerShadowVisible: false,
                              headerStyle: { backgroundColor: 'transparent' },
                              headerTintColor: overMapHeaderTint({ overHero: true, isDark }),
                            }),
                            ...(name === 'recordings/[id]' && {
                              headerTitle: () => <RecordingTitle />,
                            }),
                          }}
                        />
                      ))}
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
