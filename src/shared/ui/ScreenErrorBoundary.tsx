import React, { Component, ReactNode, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography } from '@/theme';

interface Props {
  children: ReactNode;
  screenName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

/**
 * Screen-level error boundary. Wraps individual screens so a crash
 * in one screen doesn't take down the whole app.
 *
 * The fallback UI is a function component that can use hooks
 * (useTheme, useTranslation, router).
 */
export class ScreenErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (__DEV__) {
      console.error(
        `[ScreenErrorBoundary] ${this.props.screenName || 'Screen'} error:`,
        error,
        errorInfo
      );
    }
  }

  handleRetry = () => {
    this.setState((prev) => ({ hasError: false, error: null, retryKey: prev.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <ScreenErrorFallback
          screenName={this.props.screenName}
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

interface FallbackProps {
  screenName?: string;
  error: Error | null;
  onRetry: () => void;
}

function ScreenErrorFallback({ screenName, error, onRetry }: FallbackProps) {
  const { isDark, colors: themeColors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <MaterialCommunityIcons
        name="alert-circle-outline"
        size={48}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
      <Text style={[styles.title, { color: themeColors.text }]}>{t('emptyState.error.title')}</Text>
      {screenName && (
        <Text style={[styles.screenName, { color: themeColors.textSecondary }]}>{screenName}</Text>
      )}
      {__DEV__ && error?.message && (
        <Text style={[styles.devError, { color: themeColors.textSecondary }]} numberOfLines={4}>
          {error.message}
        </Text>
      )}
      <View style={styles.buttons}>
        <Button mode="outlined" onPress={() => router.back()} style={styles.button} compact>
          {t('common.back')}
        </Button>
        <Button mode="contained" onPress={onRetry} style={styles.button} compact>
          {t('common.retry')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  title: {
    ...typography.body,
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  screenName: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  devError: {
    ...typography.label,
    marginTop: spacing.md,
    textAlign: 'center',
    maxWidth: 300,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  button: {
    minWidth: 100,
  },
});
