import React from 'react';
import { StyleSheet, View, Text, StyleProp, ViewStyle, useColorScheme } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { Button } from './Button';

interface ErrorStateProps {
  /** Error title */
  title?: string;
  /** Error message */
  message?: string;
  /** Retry handler - if provided, shows retry button */
  onRetry?: () => void;
  /** Whether retry is in progress */
  isRetrying?: boolean;
  /** Icon name from MaterialCommunityIcons */
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
  /** Compact variant for inline errors */
  compact?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Failed to load data. Please try again.',
  onRetry,
  isRetrying = false,
  icon = 'alert-circle-outline',
  style,
  compact = false,
}: ErrorStateProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (compact) {
    return (
      <View style={[styles.compactContainer, style]}>
        <MaterialCommunityIcons
          name={icon}
          size={18}
          color={colors.error}
          style={styles.compactIcon}
        />
        <Text
          style={[
            styles.compactMessage,
            { color: isDark ? darkColors.textSecondary : colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {message}
        </Text>
        {onRetry && (
          <Button
            variant="subtle"
            size="small"
            onPress={onRetry}
            loading={isRetrying}
          >
            Retry
          </Button>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconContainer, { backgroundColor: isDark ? 'rgba(229, 57, 53, 0.1)' : 'rgba(229, 57, 53, 0.08)' }]}>
        <MaterialCommunityIcons
          name={icon}
          size={32}
          color={colors.error}
        />
      </View>

      <Text style={[styles.title, { color: isDark ? darkColors.textPrimary : colors.textPrimary }]}>
        {title}
      </Text>

      <Text style={[styles.message, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}>
        {message}
      </Text>

      {onRetry && (
        <Button
          variant="secondary"
          onPress={onRetry}
          loading={isRetrying}
          icon={<MaterialCommunityIcons name="refresh" size={18} color={isDark ? darkColors.textPrimary : colors.textPrimary} />}
          style={styles.retryButton}
        >
          Try Again
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.md,
    maxWidth: 280,
  },
  retryButton: {
    marginTop: spacing.xs,
  },

  // Compact variant
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  compactIcon: {
    marginRight: spacing.xs,
  },
  compactMessage: {
    ...typography.bodySmall,
    flex: 1,
  },
});

export default ErrorState;
