/**
 * Bottom card for a tapped line on the retired layer. It names the sections the engine paired
 * with the tapped one, from whichever side was tapped, and how each is tied to it: the ledger's
 * hand-over, a hidden row, or shared ground with the overlap measured.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useMetricSystem, useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { Badge, Button, Card, IconButton } from '@/shared/ui';
import { ButtonRow } from '@/shared/ui/ButtonRow';
import { Icon } from '@/shared/ui/Icon';
import { formatDistance, formatPercent } from '@/shared/format';
import type {
  RetiredSelection,
  RetiredSelectionPair,
} from '@/features/routes/lib/retiredLineCollection';

/** A section's length and passes on one line; a figure the engine does not hold is left out. */
function statsLine(
  distanceMeters: number | null | undefined,
  visitCount: number | null | undefined,
  isMetric: boolean
): string | null {
  const parts = [
    distanceMeters != null ? formatDistance(distanceMeters, isMetric) : null,
    visitCount != null ? `${visitCount}×` : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(' · ') : null;
}

/** The sentence for a ledger or supersession tie, by which side was tapped. */
const LINK_KEYS = {
  retired: {
    ledger: 'sectionHistory.pairRetiredLedger',
    supersedes: 'sectionHistory.pairRetiredSupersedes',
  },
  current: {
    ledger: 'sectionHistory.pairCurrentLedger',
    supersedes: 'sectionHistory.pairCurrentSupersedes',
  },
} as const;

interface RetiredPairCardProps {
  selection: RetiredSelection;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Restore a retired section from the ledger version the engine named. */
  onRestore?: ((sectionId: string, version: number) => void) | undefined;
  /** Keep the first section of a pair; the second leaves the catalogue. */
  onPrefer?: ((keptId: string, otherId: string) => void) | undefined;
  /** Remove a current section from the catalogue. */
  onRemove?: ((sectionId: string) => void) | undefined;
  /** A restore is running, so the button waits for it. */
  restoring?: boolean | undefined;
}

export function RetiredPairCard({
  selection,
  onSelect,
  onClose,
  onRestore,
  onPrefer,
  onRemove,
  restoring,
}: RetiredPairCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const unnamed = t('sectionHistory.pairUnnamed');

  const describe = (pair: RetiredSelectionPair): string => {
    const name = pair.name ?? unnamed;
    if (pair.link === 'ground') return t('sectionHistory.pairGround', { name });
    return t(LINK_KEYS[selection.kind][pair.link], { name });
  };

  const ownName = selection.name ?? unnamed;
  const version = selection.restorableVersion ?? null;
  const ownStats = statsLine(selection.distanceMeters, selection.visitCount, isMetric);

  return (
    <Card
      variant="raised"
      testID="retired-pair-card"
      title={selection.name ?? unnamed}
      titleAccessory={
        <IconButton
          onPress={onClose}
          accessibilityLabel={t('common.close')}
          testID="retired-pair-close"
        >
          <Icon name="close" size={iconSize.md} color={textSecondary} />
        </IconButton>
      }
      style={{ gap: spacing.sm }}
    >
      <View style={styles.badgeRow}>
        <Badge
          tone={selection.kind === 'retired' ? 'negative' : 'neutral'}
          text={t(
            selection.kind === 'retired'
              ? 'sectionHistory.pairKindRetired'
              : 'sectionHistory.pairKindCurrent'
          )}
          isDark={isDark}
        />
      </View>
      {ownStats ? (
        <Text style={[styles.meta, { color: textSecondary }]} testID="retired-pair-own-stats">
          {ownStats}
        </Text>
      ) : null}
      {selection.kind === 'retired' && version !== null && onRestore ? (
        <Button
          variant="secondary"
          size="sm"
          loading={restoring === true}
          onPress={() => onRestore(selection.id, version)}
          label={t('common.restore')}
          accessibilityLabel={t('sectionHistory.restoreLabel', { name: ownName })}
          testID="retired-restore"
        />
      ) : null}
      {selection.kind === 'current' && onRemove ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={() => onRemove(selection.id)}
          label={t('common.remove')}
          accessibilityLabel={t('sectionHistory.removeLabel', { name: ownName })}
          testID="retired-remove"
        />
      ) : null}
      {selection.pairsPending ? (
        <Text style={[styles.line, { color: textSecondary }]} testID="retired-pairs-pending">
          {t('sectionHistory.pairsPending')}
        </Text>
      ) : null}
      {selection.pairs.length === 0 ? (
        selection.pairsPending ? null : (
          <Text style={[styles.line, { color: textSecondary }]} testID="retired-pair-none">
            {t('sectionHistory.pairNone')}
          </Text>
        )
      ) : (
        selection.pairs.map((pair) => (
          <View key={pair.id}>
            <Button
              variant="ghost"
              onPress={() => onSelect(pair.id)}
              label={describe(pair)}
              testID={`retired-pair-${pair.id}`}
            />
            {statsLine(pair.distanceMeters, pair.visitCount, isMetric) ? (
              <Text
                style={[styles.meta, { color: textSecondary }]}
                testID={`retired-pair-stats-${pair.id}`}
              >
                {statsLine(pair.distanceMeters, pair.visitCount, isMetric)}
              </Text>
            ) : null}
            {pair.overlap !== null ? (
              <Text style={[styles.meta, { color: textSecondary }]}>
                {t('sectionHistory.pairOverlap', {
                  percent: formatPercent(Math.round(pair.overlap * 100)),
                })}
              </Text>
            ) : null}
            {pair.hidden ? (
              <Text style={[styles.meta, { color: textSecondary }]}>
                {t('sectionHistory.pairHiddenNote')}
              </Text>
            ) : null}
            {onPrefer || (onRemove && pair.kind === 'current') ? (
              <ButtonRow
                actions={[
                  ...(onPrefer
                    ? [
                        {
                          variant: 'secondary' as const,
                          size: 'sm' as const,
                          onPress: () => onPrefer(selection.id, pair.id),
                          label: t('sectionHistory.pairPreferThis'),
                          accessibilityLabel: t('sectionHistory.pairPreferLabel', {
                            kept: ownName,
                            other: pair.name ?? unnamed,
                          }),
                          testID: `retired-pair-prefer-this-${pair.id}`,
                        },
                        {
                          variant: 'secondary' as const,
                          size: 'sm' as const,
                          onPress: () => onPrefer(pair.id, selection.id),
                          label: t('sectionHistory.pairPreferOther'),
                          accessibilityLabel: t('sectionHistory.pairPreferLabel', {
                            kept: pair.name ?? unnamed,
                            other: ownName,
                          }),
                          testID: `retired-pair-prefer-${pair.kind}-${pair.id}`,
                        },
                      ]
                    : []),
                  ...(onRemove && pair.kind === 'current'
                    ? [
                        {
                          variant: 'secondary' as const,
                          size: 'sm' as const,
                          onPress: () => onRemove(pair.id),
                          label: t('common.remove'),
                          accessibilityLabel: t('sectionHistory.removeLabel', {
                            name: pair.name ?? unnamed,
                          }),
                          testID: `retired-pair-remove-${pair.id}`,
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  line: {
    ...typography.bodyCompact,
  },
  meta: {
    ...typography.caption,
  },
});
