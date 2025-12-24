/**
 * Processing banner component.
 * Shows route processing progress with option to cancel.
 */

import React from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, ProgressBar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import type { RouteProcessingProgress } from '@/types';

interface ProcessingBannerProps {
  /** Processing progress */
  progress: RouteProcessingProgress;
  /** Callback to cancel processing */
  onCancel?: () => void;
  /** Compact mode (smaller) */
  compact?: boolean;
}

function getStatusIcon(
  status: RouteProcessingProgress['status']
): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (status) {
    case 'filtering':
      return 'filter-outline';
    case 'fetching':
      return 'cloud-download-outline';
    case 'processing':
      return 'cog-outline';
    case 'matching':
      return 'vector-intersection';
    case 'complete':
      return 'check-circle-outline';
    case 'error':
      return 'alert-circle-outline';
    default:
      return 'information-outline';
  }
}

function getStatusMessage(progress: RouteProcessingProgress): string {
  if (progress.message) return progress.message;

  switch (progress.status) {
    case 'idle':
      return 'Ready to process';
    case 'filtering':
      return progress.candidatesFound !== undefined
        ? `Found ${progress.candidatesFound} potential matches`
        : `Step 1: Checking ${progress.total} activities...`;
    case 'fetching':
      return `Step 2: Fetching GPS data...`;
    case 'processing':
      return `Step 2: Analysing ${progress.current} of ${progress.total} activities`;
    case 'matching':
      return 'Step 3: Grouping routes...';
    case 'complete':
      return 'Analysis complete';
    case 'error':
      return 'An error occurred';
  }
}

export function ProcessingBanner({
  progress,
  onCancel,
  compact = false,
}: ProcessingBannerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const isActive =
    progress.status === 'filtering' ||
    progress.status === 'fetching' ||
    progress.status === 'processing' ||
    progress.status === 'matching';

  const progressValue = progress.total > 0 ? progress.current / progress.total : 0;
  const statusIcon = getStatusIcon(progress.status);
  const statusMessage = getStatusMessage(progress);

  const statusColor =
    progress.status === 'error'
      ? colors.error
      : progress.status === 'complete'
        ? colors.success
        : colors.primary;

  if (progress.status === 'idle' && progress.total === 0) {
    return null;
  }

  if (compact) {
    return (
      <View style={[styles.compactContainer, isDark && styles.containerDark]}>
        <MaterialCommunityIcons name={statusIcon} size={14} color={statusColor} />
        <Text style={[styles.compactText, isDark && styles.textDark]}>
          {isActive ? `${progress.current}/${progress.total}` : statusMessage}
        </Text>
        {isActive && (
          <View style={styles.compactProgress}>
            <ProgressBar
              progress={progressValue}
              color={statusColor}
              style={styles.progressBarCompact}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <View style={styles.statusRow}>
          <MaterialCommunityIcons name={statusIcon} size={20} color={statusColor} />
          <Text style={[styles.statusText, isDark && styles.textLight]}>
            Analysing routes
          </Text>
        </View>

        {isActive && onCancel && (
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons
              name="close"
              size={20}
              color={isDark ? '#888' : colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {isActive && (
        <>
          <ProgressBar
            progress={progressValue}
            color={statusColor}
            style={styles.progressBar}
          />
          <Text style={[styles.progressText, isDark && styles.textMuted]}>
            {statusMessage}
          </Text>
        </>
      )}

      {progress.status === 'complete' && (
        <Text style={[styles.progressText, { color: colors.success }]}>
          {statusMessage}
        </Text>
      )}

      {progress.status === 'error' && (
        <Text style={[styles.progressText, { color: colors.error }]}>
          {statusMessage}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    borderRadius: 12,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  containerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  textDark: {
    color: '#AAA',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  progressText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
  },
  compactText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  compactProgress: {
    flex: 1,
    maxWidth: 60,
  },
  progressBarCompact: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
});
