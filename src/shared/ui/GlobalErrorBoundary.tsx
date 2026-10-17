import React, { Component, ReactNode, useState } from 'react';
import { Appearance, Pressable, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { i18n } from '@/i18n';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { shareCrashLog } from '@/shared/app/supportLinks';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';
import { settleForcedRenderCrash } from '@/shared/debug/forcedRenderCrash';
import { errorScreen, layout, typography, spacing, stroke } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';
import { StatusLine } from './StatusLine';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

/**
 * Top-level error boundary that wraps the entire app.
 * Needs no providers. Reads translations defensively with an English fallback.
 *
 * Retry remounts the children under a new key, so a release build always has a
 * way back without asking the athlete to quit the app.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    recordBoundaryCrash(error, errorInfo, { fatal: true });
    settleForcedRenderCrash(error);
    if (__DEV__) {
      console.error('[GlobalErrorBoundary] Uncaught error:', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState((prev) => ({ hasError: false, error: null, retryKey: prev.retryKey + 1 }));
  };

  override render() {
    if (this.state.hasError) {
      return <GlobalErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

/**
 * The fallback renders outside every provider, so it reads the insets the
 * device reported at launch rather than the safe-area context, and the system
 * appearance rather than the theme.
 *
 * Recording runs outside the boundary, so a live ride keeps going behind this
 * screen. It says so and offers the same stop the live screen and the
 * notification use, which keeps the ride on the device for review.
 */
function GlobalErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const status = useRecordingStore((state) => state.status);
  const [stoppedHere, setStoppedHere] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const palette = Appearance.getColorScheme() === 'light' ? errorScreen.light : errorScreen.dark;
  const insets = initialWindowMetrics?.insets;
  const live = status === 'recording' || status === 'paused';

  const title = fallbackText('emptyState.error.title', 'Something went wrong');
  const body = fallbackText(
    'errorState.libraryUnaffected',
    'Your activities on this device are unaffected.'
  );
  const rideLine = live
    ? fallbackText('errorState.rideStillRecording', 'Your ride is still recording.')
    : stoppedHere && status === 'stopped'
      ? fallbackText('errorState.rideStopped', 'Your ride is stopped and kept on this device.')
      : null;

  // The stop lands in the store before the backup write, so the line follows the
  // store even when the write or the route to review fails.
  const stopRide = async () => {
    try {
      await endRecordingSession();
    } finally {
      setStoppedHere(true);
    }
  };

  const shareLog = async () => {
    setShareFailed(false);
    try {
      if ((await shareCrashLog(i18n.t, { quiet: true })) === false) setShareFailed(true);
    } catch {
      setShareFailed(true);
    }
  };

  const stopLabel = fallbackText('errorState.stopAndSaveRide', 'Stop and save ride');
  const retryLabel = fallbackText('common.retry', 'Retry');
  const shareLabel = fallbackText('support.shareCrashLog', 'Share crash log');

  const actionStyle = [styles.action, { borderColor: palette.action }];
  const actionText = [styles.actionText, { color: palette.action }];

  return (
    <StatusLine
      tone="error"
      message={rideLine ? [title, body, rideLine] : [title, body]}
      style={[
        styles.container,
        {
          backgroundColor: palette.bg,
          paddingTop: (insets?.top ?? 0) + spacing.xl,
          paddingBottom: (insets?.bottom ?? 0) + spacing.xxl,
        },
      ]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: palette.title }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: palette.detail }]}>{body}</Text>
      {rideLine ? (
        <Text style={[styles.body, styles.rideLine, { color: palette.title }]}>{rideLine}</Text>
      ) : null}
      {__DEV__ && error?.message ? (
        <Text style={[styles.devError, { color: palette.message }]}>{error.message}</Text>
      ) : null}
      <View style={styles.actions}>
        {live ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={stopLabel}
            style={pressable(actionStyle)}
            android_ripple={pressRipple}
            onPress={() => void stopRide()}
          >
            <Text style={actionText}>{stopLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={pressable(actionStyle)}
          android_ripple={pressRipple}
          onPress={onRetry}
        >
          <Text style={actionText}>{retryLabel}</Text>
        </Pressable>
        <Pressable
          testID="error-share-crash-log"
          accessibilityRole="button"
          accessibilityLabel={shareLabel}
          style={pressable(actionStyle)}
          android_ripple={pressRipple}
          onPress={() => void shareLog()}
        >
          <Text style={actionText}>{shareLabel}</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload"
            style={pressable(actionStyle)}
            android_ripple={pressRipple}
            onPress={() => {
              // DevSettings is only available in dev builds
              const DevSettings = require('react-native').DevSettings;
              DevSettings?.reload?.();
            }}
          >
            <Text style={actionText}>Reload</Text>
          </Pressable>
        ) : null}
      </View>
      {shareFailed ? (
        <Text style={[styles.body, styles.rideLine, { color: palette.message }]}>
          {fallbackText('errorState.shareFailed', "Couldn't share the crash log.")}
        </Text>
      ) : null}
    </StatusLine>
  );
}

type FallbackKey =
  | 'emptyState.error.title'
  | 'errorState.libraryUnaffected'
  | 'errorState.rideStillRecording'
  | 'errorState.rideStopped'
  | 'errorState.stopAndSaveRide'
  | 'errorState.shareFailed'
  | 'common.retry'
  | 'support.shareCrashLog';

function fallbackText(key: FallbackKey, english: string): string {
  try {
    if (!i18n.isInitialized) return english;
    const translated = i18n.t(key);
    return typeof translated === 'string' && translated !== key ? translated : english;
  } catch {
    return english;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  title: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.smPlus,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
  },
  rideLine: {
    marginTop: spacing.md,
  },
  devError: {
    fontSize: typography.bodyCompact.fontSize,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontFamily: typography.code.fontFamily,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.md,
    alignItems: 'stretch',
  },
  action: {
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.xl,
    borderRadius: layout.borderRadiusSm,
    borderWidth: stroke.one,
    alignItems: 'center',
  },
  actionText: {
    ...typography.bodyBold,
  },
});
