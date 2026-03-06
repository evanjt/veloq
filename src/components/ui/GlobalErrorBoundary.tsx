import React, { Component, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary that wraps the entire app.
 * Uses only raw react-native primitives — no providers, no theme, no translations.
 * This must never crash itself.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (__DEV__) {
      console.error('[GlobalErrorBoundary] Uncaught error:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return <GlobalErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function GlobalErrorFallback({ error }: { error: Error | null }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>Close and reopen the app to continue.</Text>
      {__DEV__ && error?.message && <Text style={styles.devError}>{error.message}</Text>}
      {__DEV__ && (
        <TouchableOpacity
          style={styles.reloadButton}
          onPress={() => {
            // DevSettings is only available in dev builds
            const DevSettings = require('react-native').DevSettings;
            DevSettings?.reload?.();
          }}
        >
          <Text style={styles.reloadText}>Reload</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    color: '#999999',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  devError: {
    color: '#FF6B6B',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  reloadButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FC4C02',
  },
  reloadText: {
    color: '#FC4C02',
    fontSize: 16,
    fontWeight: '600',
  },
});
