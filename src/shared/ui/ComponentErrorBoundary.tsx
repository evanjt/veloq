import React, { Component, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors, typography, spacing, layout, stroke } from '@/theme';
import { useTheme } from '@/shared/app';
import { Button } from './Button';
import { StatusLine } from './StatusLine';
import { useTranslation } from 'react-i18next';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';

/** The parts of a screen a fallback can name, each a key under `errorState.part`. */
export type ErrorStatePart =
  | 'map'
  | 'map3d'
  | 'terrainSnapshots'
  | 'routePerformance'
  | 'hrZonesChart'
  | 'powerZonesChart'
  | 'activityStats'
  | 'activityMap'
  | 'muscleGroups';

const PART_KEY = {
  map: 'errorState.part.map',
  map3d: 'errorState.part.map3d',
  terrainSnapshots: 'errorState.part.terrainSnapshots',
  routePerformance: 'errorState.part.routePerformance',
  hrZonesChart: 'errorState.part.hrZonesChart',
  powerZonesChart: 'errorState.part.powerZonesChart',
  activityStats: 'errorState.part.activityStats',
  activityMap: 'errorState.part.activityMap',
  muscleGroups: 'errorState.part.muscleGroups',
} as const satisfies Record<ErrorStatePart, string>;

interface Props {
  children: ReactNode;
  /** The part the fallback names to the athlete. Without one it reads as a general failure. */
  part?: ErrorStatePart;
  /** The part's name in the crash log, which stays English in every locale. */
  debugName?: string;
  /** Optional minimum height */
  minHeight?: number;
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

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { debugName, onError } = this.props;
    recordBoundaryCrash(error, errorInfo, { fatal: false, screen: debugName });
    if (__DEV__) {
      console.error(
        `[ComponentErrorBoundary] ${debugName ?? 'Component'} render error:`,
        error,
        errorInfo
      );
    }
    onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      const { part, minHeight } = this.props;
      return <ErrorFallback part={part} minHeight={minHeight} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

interface FallbackProps {
  part?: ErrorStatePart | undefined;
  minHeight?: number | undefined;
  onRetry: () => void;
}

/**
 * Retry remounts the part, which is the whole of what the athlete can do about
 * a render failure, so the hint points at it and never at restarting the app.
 */
function ErrorFallback({ part, minHeight, onRetry }: FallbackProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const title = part
    ? t('errorState.unableToLoad', { part: t(PART_KEY[part]) })
    : t('errorState.defaultTitle');
  const hint = t('errorState.retryHint');

  return (
    <StatusLine
      tone="error"
      message={[title, hint]}
      style={[
        styles.container,
        isDark && styles.containerDark,
        minHeight ? { minHeight } : undefined,
      ]}
    >
      <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{title}</Text>
      <Text style={[styles.hintText, isDark && styles.hintTextDark]}>{hint}</Text>
      <Button
        label={t('common.retry')}
        variant="secondary"
        size="sm"
        onPress={onRetry}
        style={styles.retryButton}
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
    borderRadius: layout.borderRadiusSm,
    borderWidth: stroke.one,
    borderColor: colors.divider,
  },
  containerDark: {
    backgroundColor: darkColors.background,
    borderColor: darkColors.divider,
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
});

export default ComponentErrorBoundary;
