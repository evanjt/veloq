import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Logger } from '@maplibre/maplibre-react-native';
import { QueryProvider } from '@/providers';
import { lightTheme, darkTheme } from '@/theme';

// Suppress MapLibre info/warning logs about canceled requests
// These occur when switching between map views but don't affect functionality
Logger.setLogLevel('error');

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <PaperProvider theme={theme}>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
            }}
          />
        </PaperProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
