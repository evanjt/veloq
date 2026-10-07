import React, { Component, ReactNode } from 'react';
import { View, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { i18n } from '@/i18n';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';
import { errorScreen, layout, typography, spacing } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary that wraps the entire app.
 * Needs no providers. Reads translations defensively with an English fallback.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    recordBoundaryCrash(error, errorInfo, { fatal: true });
    if (__DEV__) {
      console.error('[GlobalErrorBoundary] Uncaught error:', error, errorInfo);
    }
  }

  override render() {
    if (this.state.hasError) {
      return <GlobalErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function GlobalErrorFallback({ error }: { error: Error | null }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {fallbackText('emptyState.error.title', 'Something went wrong')}
      </Text>
      <Text style={styles.body}>
        {fallbackText('errorState.closeAndReopen', 'Close and reopen the app to continue.')}
      </Text>
      {__DEV__ && error?.message && <Text style={styles.devError}>{error.message}</Text>}
      {__DEV__ && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload"
          style={pressable(styles.reloadButton)}
          android_ripple={pressRipple}
          onPress={() => {
            // DevSettings is only available in dev builds
            const DevSettings = require('react-native').DevSettings;
            DevSettings?.reload?.();
          }}
        >
          <Text style={styles.reloadText}>Reload</Text>
        </Pressable>
      )}
    </View>
  );
}

function fallbackText(
  key: 'emptyState.error.title' | 'errorState.closeAndReopen',
  english: string
): string {
  try {
    if (!i18n.isInitialized) return english;
    const translated = i18n.t(key);
    return typeof translated === 'string' && translated !== key ? translated : english;
  } catch {
    return english;
  }
}

const IOS_TOP_INSET = spacing.xxl + spacing.smPlus;
const ANDROID_TOP_INSET = spacing.xl + spacing.sm;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: errorScreen.bg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'ios' ? IOS_TOP_INSET : ANDROID_TOP_INSET,
    paddingBottom: spacing.xxl,
  },
  title: {
    color: errorScreen.title,
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.smPlus,
  },
  body: {
    color: errorScreen.detail,
    fontSize: typography.body.fontSize,
    textAlign: 'center',
    lineHeight: 22,
  },
  devError: {
    color: errorScreen.message,
    fontSize: typography.bodyCompact.fontSize,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  reloadButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.xl,
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
    borderColor: errorScreen.action,
  },
  reloadText: {
    color: errorScreen.action,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
});
