import React, { Component, ReactNode, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { Button } from './Button';
import { StatusLine } from './StatusLine';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';
import { tapBack } from '@/shared/app/navigation';
import { offerCrashLog } from '@/shared/app/supportLinks';
import { isTabBarRoute } from './tabBarClearance';

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

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    recordBoundaryCrash(error, errorInfo, { fatal: false, screen: this.props.screenName });
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

  override render() {
    if (this.state.hasError) {
      return <ScreenErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

interface FallbackProps {
  error: Error | null;
  onRetry: () => void;
}

function ScreenErrorFallback({ error, onRetry }: FallbackProps) {
  const { isDark, colors: themeColors } = useTheme();
  const { t } = useTranslation();
  const crashLogAnchor = useRef<View>(null);
  // Back always leaves a stack screen, to the Feed when nothing is behind it. On a tab the Feed
  // may be the screen that threw, so Back there needs history to go back to.
  const offersBack = !isTabBarRoute(useSegments()) || router.canGoBack();

  const title = t('emptyState.error.title');

  return (
    <StatusLine
      tone="error"
      message={title}
      style={[styles.container, isDark && styles.containerDark]}
    >
      <MaterialCommunityIcons
        name="alert-circle-outline"
        size={iconSize.xxl}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
      <Text accessibilityRole="header" style={[styles.title, { color: themeColors.text }]}>
        {title}
      </Text>
      {__DEV__ && error?.message ? (
        <Text style={[styles.devError, { color: themeColors.textSecondary }]} numberOfLines={4}>
          {error.message}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        {offersBack ? (
          <Button
            label={t('common.back')}
            variant="secondary"
            size="sm"
            onPress={() => tapBack()}
            style={styles.button}
          />
        ) : null}
        <Button label={t('common.retry')} size="sm" onPress={onRetry} style={styles.button} />
      </View>
      <Button
        ref={crashLogAnchor}
        testID="error-share-crash-log"
        label={t('support.shareCrashLog')}
        variant="ghost"
        size="sm"
        onPress={() => void offerCrashLog(t, crashLogAnchor)}
        style={styles.shareButton}
      />
    </StatusLine>
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
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    marginTop: spacing.md,
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
  shareButton: {
    marginTop: spacing.md,
  },
});
