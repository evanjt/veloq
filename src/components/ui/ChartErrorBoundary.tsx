import React, { Component, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors, typography, spacing } from '@/theme';
import { useTheme } from '@/hooks';

interface Props {
  children: ReactNode;
  /** Optional fallback height to match chart */
  height?: number;
  /** Optional label for error message */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary specifically for chart components.
 * Catches render errors and displays a graceful fallback.
 */
export class ChartErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ChartErrorBoundary] Chart render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const { height = 150, label } = this.props;
      return (
        <ChartErrorFallback
          height={height}
          label={label}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}

interface FallbackProps {
  height: number;
  label?: string;
  onRetry: () => void;
}

function ChartErrorFallback({ height, label, onRetry }: FallbackProps) {
  const { isDark } = useTheme();

  return (
    <View style={[styles.container, { height }]}>
      <Text style={[styles.errorText, isDark && styles.errorTextDark]}>
        {label ? `Unable to display ${label}` : 'Unable to display chart'}
      </Text>
      <Text style={[styles.retryText, isDark && styles.retryTextDark]} onPress={onRetry}>
        Tap to retry
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  errorTextDark: {
    color: darkColors.textSecondary,
  },
  retryText: {
    ...typography.label,
    color: colors.primary,
  },
  retryTextDark: {
    color: colors.primaryLight,
  },
});

export default ChartErrorBoundary;
