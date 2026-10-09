import React, { Component, ReactNode } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors, typography, spacing, layout } from '@/theme';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';
import { pressable, pressRipple } from '@/shared/ui';

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

  return (
    <View style={[styles.container, isDark && styles.containerDark, { height }]}>
      <Text style={[styles.errorText, isDark && styles.errorTextDark]}>
        {t('errorState.unableToDisplayChart')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('errorState.tapToRetry')}
        onPress={onRetry}
        style={pressable(styles.retryButton)}
        android_ripple={pressRipple}
      >
        <Text style={[styles.retryText, isDark && styles.retryTextDark]}>
          {t('errorState.tapToRetry')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  containerDark: {
    backgroundColor: darkColors.background,
    borderColor: darkColors.divider,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  errorTextDark: {
    color: darkColors.textSecondary,
  },
  retryButton: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
  },
  retryText: {
    ...typography.label,
    color: colors.linkTeal,
  },
  retryTextDark: {
    color: darkColors.linkTeal,
  },
});

export default ChartErrorBoundary;
