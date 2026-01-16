import { useEffect, useState } from "react";
import { Stack, useSegments, useRouter, Href } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import {
  useColorScheme,
  View,
  ActivityIndicator,
  Platform,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from "react-native-reanimated";
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from "expo-file-system/legacy";
import { Logger as MapLibreLogger } from "@maplibre/maplibre-react-native";
import {
  QueryProvider,
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
} from "@/providers";
import { initializeI18n } from "@/i18n";
import { lightTheme, darkTheme, colors, darkColors } from "@/theme";
import {
  CacheLoadingBanner,
  DemoBanner,
  GlobalDataSync,
  OfflineBanner,
} from "@/components/ui";

// Lazy load native module to avoid bundler errors
function getRouteEngine() {
  try {
    const module = require("route-matcher-native");
    // The module exports both a default export and a named routeEngine export
    // Try to get the named export first, fall back to the default
    return module.routeEngine || module.default?.routeEngine || null;
  } catch (error) {
    if (__DEV__) {
      console.warn("[RouteMatcher] Failed to load native module:", error);
    }
    return null;
  }
}

// Database path for persistent route engine (SQLite)
// FileSystem.documentDirectory returns a file:// URI, but SQLite needs a plain path
const getRouteDbPath = () => {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return null;
  // Strip file:// prefix if present for SQLite compatibility
  const plainPath = docDir.startsWith("file://") ? docDir.slice(7) : docDir;
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
    MapLibreLogger.setLogLevel("error");
    mapLibreLoggerConfigured = true;
  } catch (error) {
    if (__DEV__) {
      console.warn("[MapLibre] Failed to configure logger:", error);
    }
  }
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const routeParts = useSegments();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();

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
            console.warn(
              "[RouteEngine] Cannot initialize - document directory not available. " +
                "Route features will be disabled until app restart.",
            );
          }
          return;
        }
        const success = engine.initWithPath(dbPath);
        if (__DEV__) {
          if (success) {
            console.log(
              `[RouteEngine] Initialized with persistent storage: ${engine.getActivityCount()} cached activities`,
            );
          } else {
            console.warn(
              `[RouteEngine] Persistent init failed for path: ${dbPath}. ` +
                "Route features will be disabled until app restart.",
            );
          }
        }
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading) return;

    const inLoginScreen = routeParts.includes("login" as never);

    if (!isAuthenticated && !inLoginScreen) {
      // Not authenticated and not on login screen - redirect to login
      router.replace("/login" as Href);
    } else if (isAuthenticated && inLoginScreen) {
      // Authenticated but on login screen - redirect to main app
      router.replace("/" as Href);
    }
  }, [isAuthenticated, isLoading, routeParts, router]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
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
  const theme = colorScheme === "dark" ? darkTheme : lightTheme;
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
      await Promise.all([
        initializeTheme(),
        initializeAuth(),
        initializeSportPreference(),
        initializeHRZones(),
        initializeRouteSettings(),
        initializeSupersededSections(),
        initializeDisabledSections(),
      ]);
    }
    initialize().finally(() => setAppReady(true));
  }, [initializeAuth]);

  // Show minimal loading while initializing
  if (!appReady) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
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
                  style={colorScheme === "dark" ? "light" : "dark"}
                  translucent={Platform.OS === "ios"}
                  hidden={SCREENSHOT_MODE}
                  animated
                />
                <AuthGate>
                  <OfflineBanner />
                  <GlobalDataSync />
                  <DemoBanner />
                  <CacheLoadingBanner />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      // iOS: Use default animation for native feel with gesture support
                      // Android: Slide from right for Material Design
                      animation:
                        Platform.OS === "ios" ? "default" : "slide_from_right",
                      // Enable swipe-back gesture on both platforms
                      gestureEnabled: true,
                      gestureDirection: "horizontal",
                      // iOS: Blur effect for any translucent headers
                      headerBlurEffect:
                        Platform.OS === "ios" ? "prominent" : undefined,
                      headerTransparent: Platform.OS === "ios",
                    }}
                  />
                </AuthGate>
              </PaperProvider>
            </MapPreferencesProvider>
          </TopSafeAreaProvider>
        </NetworkProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
