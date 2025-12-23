import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { Text, TextInput, Button, HelperText, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { useAuthStore } from '@/providers';
import { intervalsApi } from '@/api/intervals';
import { colors, spacing, layout } from '@/theme';

export default function LoginScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const setCredentials = useAuthStore((state) => state.setCredentials);

  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenSettings = () => {
    Linking.openURL('https://intervals.icu/settings');
  };

  const handleLogin = async () => {
    if (!apiKey.trim()) {
      setError('API Key is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Temporarily set just the API key so we can make the request
      await setCredentials(apiKey.trim(), '');

      // Fetch the current athlete to get the athlete ID
      const athlete = await intervalsApi.getCurrentAthlete();

      if (!athlete.id) {
        throw new Error('Could not retrieve athlete ID');
      }

      // Now save with the correct athlete ID
      await setCredentials(apiKey.trim(), athlete.id);

      // Success - navigate to main app
      router.replace('/' as Href);
    } catch (err: unknown) {
      // Clear invalid credentials
      await useAuthStore.getState().clearCredentials();

      const error = err as { response?: { status?: number } };
      if (error?.response?.status === 401) {
        setError('Invalid API Key. Please check your key and try again.');
      } else {
        setError('Failed to connect. Please check your API key and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo/Header */}
          <View style={styles.header}>
            <Text style={[styles.title, isDark && styles.textLight]}>Veloq</Text>
            <Text style={[styles.subtitle, isDark && styles.textDark]}>
              Connect to Intervals.icu
            </Text>
          </View>

          {/* Instructions */}
          <View style={[styles.card, isDark && styles.cardDark]}>
            <Text style={[styles.instructionTitle, isDark && styles.textLight]}>
              Getting Started
            </Text>
            <Text style={[styles.instruction, isDark && styles.textDark]}>
              1. Open Intervals.icu Settings{'\n'}
              2. Scroll to "Developer Settings"{'\n'}
              3. Copy your API Key
            </Text>
            <Button
              mode="outlined"
              onPress={handleOpenSettings}
              icon="open-in-new"
              style={styles.settingsButton}
            >
              Open Intervals.icu Settings
            </Button>
          </View>

          {/* Credentials Form */}
          <View style={[styles.card, isDark && styles.cardDark]}>
            <TextInput
              label="API Key"
              value={apiKey}
              onChangeText={setApiKey}
              mode="outlined"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              left={<TextInput.Icon icon="key" />}
              disabled={isLoading}
            />

            {error && (
              <HelperText type="error" visible={true}>
                {error}
              </HelperText>
            )}

            <Button
              mode="contained"
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading || !apiKey.trim()}
              style={styles.loginButton}
              contentStyle={styles.loginButtonContent}
            >
              {isLoading ? 'Connecting...' : 'Connect'}
            </Button>
          </View>

          {/* Security note */}
          <View style={styles.securityNote}>
            <MaterialCommunityIcons
              name="shield-lock"
              size={16}
              color={isDark ? '#888' : colors.textSecondary}
            />
            <Text style={[styles.securityText, isDark && styles.textDark]}>
              Your credentials are stored securely on your device
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: layout.screenPadding,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  instructionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  instruction: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  settingsButton: {
    marginTop: spacing.xs,
  },
  input: {
    marginBottom: spacing.md,
  },
  loginButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
  },
  loginButtonContent: {
    paddingVertical: spacing.xs,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  securityText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
