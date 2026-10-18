import { listCountLabel, SECTION_COUNT_KEYS } from '@/features/routes/lib/listCountLabel';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Button, IconButton, SearchBar } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { isElevationHold, type DetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { rescanRefusalKey } from '@/features/routes/lib/rescanRefusal';
import type { StartVerdict } from 'veloqrs';
import type { ElevationBackfillState } from '@/features/routes/hooks/useElevationBackfill';

interface SectionsListHeaderProps {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  displaySectionCount: number;
  shownSectionCount?: number;
  unacceptedAutoCount: number;
  acceptAllResult: number | null;
  isScanning: boolean;
  /** Why the engine is refusing to detect, or null when it is not. */
  detectionHold: DetectionHold;
  /** The elevation download this page reports for the length of the migration. */
  elevationBackfill?: ElevationBackfillState | undefined;
  /** How the engine answered the last rescan, when it refused it. */
  rescanRefusal?: StartVerdict | null | undefined;
  onAcceptAll: () => void;
  onRescan: () => void;
}

export function SectionsListHeader({
  searchQuery,
  onSearchChange,
  displaySectionCount,
  shownSectionCount,
  unacceptedAutoCount,
  acceptAllResult,
  isScanning,
  detectionHold,
  elevationBackfill,
  rescanRefusal = null,
  onAcceptAll,
  onRescan,
}: SectionsListHeaderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // A refusal the athlete asked for outranks the standing hold line: the hold
  // says what is going on, the refusal answers the tap.
  const refusalKey = rescanRefusalKey(rescanRefusal);

  // A queue nothing is working on ends on the network, so the hold line sizes
  // it and says what lifts it. An engine that could not answer leaves the
  // count null, and the unsized sentence stands rather than a bare number.
  const waitingCount =
    detectionHold === 'elevation-waiting' &&
    elevationBackfill != null &&
    elevationBackfill.remaining !== null &&
    elevationBackfill.remaining > 0
      ? elevationBackfill.remaining
      : null;

  // A pass reports itself; at rest the durable count is what is owed. A null
  // count is an engine that could not answer and must not read as finished.
  // The hold line carries the count while it waits, so this row would repeat it.
  const elevationLine =
    !elevationBackfill || waitingCount !== null
      ? null
      : elevationBackfill.isRunning
        ? t('settings.elevationBackfillProgress', {
            completed: elevationBackfill.completed,
            total: elevationBackfill.total,
          })
        : elevationBackfill.remaining !== null && elevationBackfill.remaining > 0
          ? t('settings.elevationBackfillOutstanding', { count: elevationBackfill.remaining })
          : null;

  const rescanDisabled = isScanning || detectionHold !== null;

  return (
    <>
      <SearchBar
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder={t('routes.searchSections')}
        style={styles.searchBar}
      />
      <View style={styles.countRow}>
        <Text
          testID="sections-count"
          style={[styles.summaryText, isDark && styles.summaryTextDark]}
        >
          {listCountLabel(
            t,
            SECTION_COUNT_KEYS,
            shownSectionCount ?? displaySectionCount,
            displaySectionCount
          )}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {unacceptedAutoCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onPress={onAcceptAll}
              icon="pin-outline"
              label={t('sections.acceptAllSections')}
            />
          )}
          {acceptAllResult !== null && (
            <Text
              style={{
                fontSize: typography.label.fontSize,
                color: isDark ? darkColors.textSecondary : colors.textSecondary,
              }}
            >
              {t('sections.acceptedCount', { count: acceptAllResult })}
            </Text>
          )}
          <IconButton
            onPress={onRescan}
            accessibilityLabel={t('settings.reanalyzeSections')}
            disabled={rescanDisabled}
          >
            {isScanning ? (
              <IconButton.Spinner />
            ) : (
              <Icon
                name="reload"
                size={iconSize.sm}
                color={
                  rescanDisabled
                    ? isDark
                      ? darkColors.textDisabled
                      : colors.textDisabled
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
                }
              />
            )}
          </IconButton>
        </View>
      </View>
      {elevationLine !== null && (
        <View style={styles.pausedRow} testID="elevation-backfill-row">
          <Icon
            name="elevation-rise"
            size={iconSize.xs}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.pausedText, isDark && styles.pausedTextDark]}>{elevationLine}</Text>
        </View>
      )}
      {refusalKey !== null && (
        <View style={styles.pausedRow} testID="rescan-refused">
          <Icon
            name="information-outline"
            size={iconSize.xs}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.pausedText, isDark && styles.pausedTextDark]}>{t(refusalKey)}</Text>
        </View>
      )}
      {detectionHold !== null && (
        <View style={styles.pausedRow} testID="detection-paused">
          <Icon
            name="pause-circle-outline"
            size={iconSize.xs}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.pausedText, isDark && styles.pausedTextDark]}>
            {detectionHold === 'elevation-paused'
              ? t('sections.detectionHeldElevationPaused')
              : waitingCount !== null
                ? t('sections.detectionHeldElevationWaiting', { count: waitingCount })
                : isElevationHold(detectionHold)
                  ? t('sections.detectionPausedElevation')
                  : t('sections.detectionPaused')}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
  },
  summaryText: {
    ...typography.bodyCompactBold,
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
    ...typography.caption,
    color: colors.textSecondary,
  },
  pausedTextDark: {
    color: darkColors.textSecondary,
  },
});
