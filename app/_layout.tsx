import { useEffect, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View, ActivityIndicator, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Logger } from '@maplibre/maplibre-react-native';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { QueryProvider, MapPreferencesProvider, initializeTheme, useAuthStore, initializeSportPreference, initializeHRZones, initializeRouteSettings, initializeLanguage } from '@/providers';
import { initializeI18n } from '@/i18n';
import { lightTheme, darkTheme, colors, darkColors } from '@/theme';
import { CacheLoadingBanner, DemoBanner, GlobalDataSync } from '@/components/ui';

// Lazy load native module to avoid bundler errors
function getRouteEngine() {
  try {
    return require('route-matcher-native').routeEngine;
  } catch {
    return null;
  }
}

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

  // Initialize Rust route engine when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const engine = getRouteEngine();
      if (engine) engine.init();
    }
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

  // Initialize theme, auth, sport preference, HR zones, route settings, and i18n on app start
  useEffect(() => {
    async function initialize() {
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
      ]);
    }
    initialize().finally(() => setAppReady(true));
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
              <GlobalDataSync />
              <DemoBanner />
              <CacheLoadingBanner />
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
              />
            </AuthGate>
          </PaperProvider>
        </MapPreferencesProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
