import React from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import type { DetectionHold } from '@/features/routes/hooks/useDetectionHold';
import type { ElevationBackfillState } from '@/features/routes/hooks/useElevationBackfill';

interface SectionsListHeaderProps {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  displaySectionCount: number;
  unacceptedAutoCount: number;
  acceptAllResult: number | null;
  isScanning: boolean;
  /** Why the engine is refusing to detect, or null when it is not. */
  detectionHold: DetectionHold;
  /** The elevation download this page reports for the length of the migration. */
  elevationBackfill?: ElevationBackfillState;
  onAcceptAll: () => void;
  onRescan: () => void;
}

export function SectionsListHeader({
  searchQuery,
  onSearchChange,
  displaySectionCount,
  unacceptedAutoCount,
  acceptAllResult,
  isScanning,
  detectionHold,
  elevationBackfill,
  onAcceptAll,
  onRescan,
}: SectionsListHeaderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // A pass reports itself; at rest the durable count is what is owed. A null
  // count is an engine that could not answer and must not read as finished.
  const elevationLine = elevationLabel(elevationBackfill, t);

  return (
    <>
      <View style={[styles.searchContainer, isDark && styles.searchContainerDark]}>
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color={isDark ? darkColors.textDisabled : colors.textDisabled}
        />
        <TextInput
          style={[styles.searchInput, isDark && styles.searchInputDark]}
          placeholder={t('routes.searchSections')}
          placeholderTextColor={isDark ? darkColors.textDisabled : colors.textDisabled}
          value={searchQuery}
          onChangeText={onSearchChange}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => onSearchChange('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.clearSearch')}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={16}
              color={isDark ? darkColors.textDisabled : colors.textDisabled}
            />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.countRow}>
        <Text style={[styles.summaryText, isDark && styles.summaryTextDark]}>
          {displaySectionCount} {t('trainingScreen.sections')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {unacceptedAutoCount > 0 && (
            <TouchableOpacity
              onPress={onAcceptAll}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <MaterialCommunityIcons name="pin-outline" size={13} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary }}>
                {t('sections.acceptAllSections')}
              </Text>
            </TouchableOpacity>
          )}
          {acceptAllResult !== null && (
            <Text
              style={{
                fontSize: 11,
                color: isDark ? darkColors.textSecondary : colors.textSecondary,
              }}
            >
              {t('sections.acceptedCount', { count: acceptAllResult })}
            </Text>
          )}
          <TouchableOpacity
            onPress={onRescan}
            disabled={isScanning || detectionHold !== null}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isScanning ? (
              <ActivityIndicator
                size={13}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            ) : (
              <MaterialCommunityIcons
                name="reload"
                size={14}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>
      {elevationLine !== null && (
        <View style={styles.pausedRow} testID="elevation-backfill-row">
          <MaterialCommunityIcons
            name="elevation-rise"
            size={13}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.pausedText, isDark && styles.pausedTextDark]}>{elevationLine}</Text>
        </View>
      )}
      {detectionHold !== null && (
        <View style={styles.pausedRow} testID="detection-paused">
          <MaterialCommunityIcons
            name="pause-circle-outline"
            size={13}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.pausedText, isDark && styles.pausedTextDark]}>
            {detectionHold === 'elevation'
              ? t('sections.detectionPausedElevation')
              : t('sections.detectionPaused')}
          </Text>
        </View>
      )}
    </>
  );
}

/** What the row says, or null when there is nothing owed to say it about. */
function elevationLabel(
  state: ElevationBackfillState | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string
): string | null {
  if (!state) return null;
  if (state.isRunning) {
    return t('settings.elevationBackfillProgress', {
      completed: state.completed,
      total: state.total,
    });
  }
  if (state.remaining === null || state.remaining <= 0) return null;
  return t('settings.elevationBackfillOutstanding', { count: state.remaining });
}

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 4 : 2,
    borderRadius: 10,
    backgroundColor: colors.gray100,
  },
  searchContainerDark: {
    backgroundColor: darkColors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: colors.textOnDark,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  summaryTextDark: {
    color: darkColors.textPrimary,
  },
  pausedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  pausedText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  pausedTextDark: {
    color: darkColors.textSecondary,
  },
});
