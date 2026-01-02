/**
 * Error boundary for route-related screens.
 *
 * Catches errors in route matching, grouping, and display components
 * to prevent crashes from cascading through the entire app.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary class component for route screens.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[RouteErrorBoundary] Caught error:', error);
    console.error('[RouteErrorBoundary] Error info:', errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.title}>Route Display Error</Text>
            <Text style={styles.message}>
              Something went wrong while displaying routes. This has been logged.
            </Text>
            {this.state.error && <Text style={styles.errorDetail}>{this.state.error.message}</Text>}
            <Pressable style={styles.button} onPress={this.handleReset}>
              <Text style={styles.buttonText}>Try Again</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    maxWidth: 400,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 16,
  },
  errorDetail: {
    fontSize: 14,
    color: '#999999',
    textAlign: 'center',
    marginBottom: 24,
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: '#FC4C02',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

/**
 * Hook version for functional components.
 *
 * @example
 * ```tsx
 * function MyRouteScreen() {
 *   useRouteErrorBoundary();
 *   // ... component logic
 * }
 * ```
 */
export function useRouteErrorBoundary() {
  // This is a placeholder - React doesn't support error boundaries in hooks yet
  // Use the class component above instead
  console.warn(
    '[useRouteErrorBoundary] Error boundaries must be class components. ' +
      'Use <RouteErrorBoundary> wrapper instead.'
  );
}
