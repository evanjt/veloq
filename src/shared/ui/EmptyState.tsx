import React, { ComponentProps } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/shared/app';
import {
  spacing,
  layout,
  colors,
  gradients,
  colorWithOpacity,
  ink,
  shadows,
  typography,
} from '@/theme';

interface EmptyStateProps {
  /** Icon name from MaterialCommunityIcons */
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Main title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button text */
  actionLabel?: string;
  /** Action button callback */
  onAction?: () => void;
  /** Compact mode for inline display */
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  const { isDark, colors } = useTheme();

  return (
    <View style={[styles.container, compact && styles.containerCompact]} testID="empty-state">
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: isDark
              ? colorWithOpacity(ink.white, 0.1)
              : colorWithOpacity(ink.black, 0.05),
          },
          compact && styles.iconContainerCompact,
        ]}
      >
        <MaterialCommunityIcons
          name={icon}
          size={compact ? 32 : 48}
          color={isDark ? colorWithOpacity(ink.white, 0.4) : colorWithOpacity(ink.black, 0.3)}
        />
      </View>

      <Text style={[styles.title, { color: colors.text }, compact && styles.titleCompact]}>
        {title}
      </Text>

      {description && (
        <Text
          style={[
            styles.description,
            { color: colors.textSecondary },
            compact && styles.descriptionCompact,
          ]}
        >
          {description}
        </Text>
      )}

      {actionLabel && onAction && (
        <TouchableOpacity style={styles.actionButton} onPress={onAction} activeOpacity={0.8}>
          <LinearGradient
            colors={[...gradients.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.actionGradient}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function NetworkErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="wifi-off"
      title={t('emptyState.networkError.title')}
      description={t('emptyState.networkError.description')}
      actionLabel={onRetry ? t('common.retry') : undefined}
      onAction={onRetry}
    />
  );
}

// Preset for generic error
export function ErrorStatePreset({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="alert-circle-outline"
      title={t('emptyState.error.title')}
      description={message || t('emptyState.error.description')}
      actionLabel={onRetry ? t('errorState.tryAgain') : undefined}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  containerCompact: {
    paddingVertical: spacing.lg,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48, // half of width for circle
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconContainerCompact: {
    width: 64,
    height: 64,
    borderRadius: 32, // half of width for circle
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  titleCompact: {
    fontSize: 16,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  descriptionCompact: {
    fontSize: 13,
    maxWidth: 240,
  },
  actionButton: {
    marginTop: spacing.lg,
    borderRadius: layout.borderRadiusLg,
    overflow: 'hidden',
    ...shadows.tealGlow,
  },
  actionGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  actionText: {
    color: colors.textOnDark,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
});
