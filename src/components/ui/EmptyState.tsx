import React, { ComponentProps } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/hooks';
import { spacing } from '@/theme';

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
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' },
          compact && styles.iconContainerCompact,
        ]}
      >
        <MaterialCommunityIcons
          name={icon}
          size={compact ? 32 : 48}
          color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'}
        />
      </View>

      <Text
        style={[
          styles.title,
          { color: colors.text },
          compact && styles.titleCompact,
        ]}
      >
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
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#FF6B2C', '#FC4C02']}
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

// Preset for no activities
export function NoActivitiesState({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <EmptyState
      icon="run"
      title="No activities yet"
      description="Your activities will appear here once you sync with Intervals.icu"
      actionLabel={onRefresh ? "Refresh" : undefined}
      onAction={onRefresh}
    />
  );
}

// Preset for no results (search/filter)
export function NoResultsState({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      icon="magnify-close"
      title="No results found"
      description="Try adjusting your search or filters"
      actionLabel={onClear ? "Clear filters" : undefined}
      onAction={onClear}
    />
  );
}

// Preset for network error
export function NetworkErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="wifi-off"
      title="Connection error"
      description="Check your internet connection and try again"
      actionLabel={onRetry ? "Retry" : undefined}
      onAction={onRetry}
    />
  );
}

// Preset for generic error
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon="alert-circle-outline"
      title="Something went wrong"
      description={message || "We couldn't load this content"}
      actionLabel={onRetry ? "Try again" : undefined}
      onAction={onRetry}
    />
  );
}

// Preset for no data in chart/stats
export function NoDataState({ compact = true }: { compact?: boolean }) {
  return (
    <EmptyState
      icon="chart-line-variant"
      title="No data available"
      description="Complete some activities to see your stats"
      compact={compact}
    />
  );
}

// Preset for offline mode
export function OfflineState() {
  return (
    <EmptyState
      icon="cloud-off-outline"
      title="You're offline"
      description="Some features may be limited"
      compact
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
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconContainerCompact: {
    width: 64,
    height: 64,
    borderRadius: 32,
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
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#FC4C02',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  actionGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
