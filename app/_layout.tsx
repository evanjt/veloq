import { useEffect, useState } from 'react';
import { Stack, useSegments, useRouter, Href } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Logger } from '@maplibre/maplibre-react-native';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { QueryProvider, MapPreferencesProvider, initializeTheme, useAuthStore, initializeSportPreference, initializeHRZones, initializeRouteMatching, initializeRouteSettings } from '@/providers';
import { lightTheme, darkTheme, colors } from '@/theme';
import { CacheLoadingBanner } from '@/components/ui';

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

  // Initialize route matching when authenticated
  // This subscribes to bounds sync completion to auto-trigger route processing
  useEffect(() => {
    if (isAuthenticated) {
      initializeRouteMatching();
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <MapPreferencesProvider>
          <PaperProvider theme={theme}>
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
            <AuthGate>
              <CacheLoadingBanner />
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                }}
              />
            </AuthGate>
          </PaperProvider>
        </MapPreferencesProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
