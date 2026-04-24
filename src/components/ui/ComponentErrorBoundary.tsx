import React, { Component, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { colors, darkColors, typography, spacing } from '@/theme';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
  /** Component name for error message */
  componentName?: string;
  /** Optional minimum height */
  minHeight?: number;
  /** Whether to show retry button */
  showRetry?: boolean;
  /** Custom error handler */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic error boundary for any component.
 * Catches render errors and displays a graceful fallback.
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { componentName, onError } = this.props;
    if (__DEV__) {
      console.error(
        `[ComponentErrorBoundary] ${componentName || 'Component'} render error:`,
        error,
        errorInfo
      );
    }
    onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { componentName, minHeight, showRetry = true } = this.props;
      return (
        <ErrorFallback
          componentName={componentName}
          minHeight={minHeight}
          showRetry={showRetry}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

interface FallbackProps {
  componentName?: string;
  minHeight?: number;
  showRetry: boolean;
  onRetry: () => void;
}

function ErrorFallback({ componentName, minHeight, showRetry, onRetry }: FallbackProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, minHeight ? { minHeight } : undefined]}>
      <Text style={[styles.errorText, isDark && styles.errorTextDark]}>
        {componentName
          ? t('errorState.unableToLoad', { componentName })
          : t('errorState.defaultTitle')}
      </Text>
      <Text style={[styles.hintText, isDark && styles.hintTextDark]}>
        {t('errorState.restartHint')}
      </Text>
      {showRetry && (
        <Button
          mode="outlined"
          onPress={onRetry}
          style={styles.retryButton}
          labelStyle={styles.retryLabel}
          compact
        >
          {t('common.retry')}
        </Button>
      )}
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  errorText: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  errorTextDark: {
    color: darkColors.textPrimary,
  },
  hintText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  hintTextDark: {
    color: darkColors.textSecondary,
  },
  retryButton: {
    marginTop: spacing.sm,
  },
  retryLabel: {
    ...typography.label,
  },
});

export default ComponentErrorBoundary;
