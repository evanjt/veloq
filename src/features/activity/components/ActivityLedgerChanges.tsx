import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { ActivityLedgerChange } from 'veloqrs';
import { navigateTo } from '@/shared/app/navigation';
import { getIntlLocale } from '@/shared/format/format';
import { FIXED_LABEL_LEDGER_KINDS, ledgerDate } from '@/features/routes';
import { AnimatedPressable } from '@/shared/ui';
import { colors, darkColors, spacing, typography, layout } from '@/theme';

interface ActivityLedgerChangesProps {
  changes: readonly ActivityLedgerChange[];
  isDark: boolean;
}

/**
 * The section changes whose ledger rows name this activity. The wording says
 * the activity was around the change, never that it caused one.
 */
export function ActivityLedgerChanges({ changes, isDark }: ActivityLedgerChangesProps) {
  const { t } = useTranslation();
  if (changes.length === 0) return null;
  const locale = getIntlLocale();
  const textStyle = isDark ? styles.textDark : undefined;

  return (
    <View style={[styles.card, isDark && styles.cardDark]} testID="activity-ledger-changes">
      <Text style={[styles.title, textStyle]}>{t('sectionHistory.around')}</Text>
      {changes.map((change) => {
        const kindLabel = FIXED_LABEL_LEDGER_KINDS.has(change.kind)
          ? t(`sectionHistory.kind_${change.kind}` as never)
          : null;
        return (
          <AnimatedPressable
            key={`${change.eventId}-${change.relation}`}
            testID={`activity-ledger-change-${change.eventId}`}
            style={styles.row}
            onPress={() => navigateTo(`/section/${change.sectionId}`)}
            accessibilityRole="button"
            hapticFeedback={false}
          >
            <View style={styles.rowText}>
              <Text style={[styles.name, textStyle]} numberOfLines={1}>
                {change.sectionName ?? kindLabel ?? change.kind}
              </Text>
              {change.sectionName != null && kindLabel != null && (
                <Text style={styles.detail}>{kindLabel}</Text>
              )}
              {change.relation === 'fork_around' && (
                <Text style={styles.detail}>{t('sectionHistory.forkAround')}</Text>
              )}
              <Text style={styles.detail}>
                {ledgerDate(change.at).toLocaleDateString(locale, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  title: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  name: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  detail: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
});
