import React, { Component, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors, typography, spacing, layout, stroke } from '@/theme';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';
import { RetryButton } from './ErrorState';
import { StatusLine } from './StatusLine';

interface Props {
  children: ReactNode;
  /** Optional fallback height to match chart */
  height?: number;
  /** The chart's name in the crash log. The fallback the athlete reads never shows it. */
  chartName?: string;
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

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    recordBoundaryCrash(error, errorInfo, { fatal: false, screen: this.props.chartName });
    if (__DEV__) {
      console.error('[ChartErrorBoundary] Chart render error:', error, errorInfo);
    }
  }

  override render() {
    if (this.state.hasError) {
      const { height = 150 } = this.props;
      return (
        <ChartErrorFallback
          height={height}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}

interface FallbackProps {
  height: number;
  onRetry: () => void;
}

function ChartErrorFallback({ height, onRetry }: FallbackProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const message = t('errorState.unableToDisplayChart');

  return (
    <StatusLine
      tone="error"
      message={message}
      style={[styles.container, isDark && styles.containerDark, { height }]}
    >
      <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{message}</Text>
      <RetryButton onPress={onRetry} />
    </StatusLine>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfacePage,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
    borderWidth: stroke.one,
    borderColor: colors.border,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
    borderColor: darkColors.border,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  errorTextDark: {
    color: darkColors.textSecondary,
  },
});

export default ChartErrorBoundary;
