import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { ActivityLedgerChange } from 'veloqrs';
import { navigateTo } from '@/shared/app/navigation';
import { formatFullDate } from '@/shared/format/format';
import { FIXED_LABEL_LEDGER_KINDS, ledgerDate } from '@/features/routes';
import { Card, CardHeader, Row } from '@/shared/ui';
import { spacing, typography, themedStyles, type Palette } from '@/theme';
import { NameText } from '@/shared/ui/NameText';

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
  const styles = themedStyles(makeStyles, isDark);

  return (
    <View style={styles.frame} testID="activity-ledger-changes">
      <Card variant="flat" padding="none">
        <View style={styles.body}>
          <View style={styles.header}>
            <CardHeader title={t('sectionHistory.around')} />
          </View>
          {changes.map((change) => {
            const kindLabel = FIXED_LABEL_LEDGER_KINDS.has(change.kind)
              ? t(`sectionHistory.kind_${change.kind}` as never)
              : null;
            const name = change.sectionName ?? kindLabel ?? change.kind;
            const date = formatFullDate(ledgerDate(change.at));
            return (
              <Row
                key={`${change.eventId}-${change.relation}`}
                testID={`activity-ledger-change-${change.eventId}`}
                onPress={() => navigateTo(`/section/${change.sectionId}`)}
                accessibilityLabel={`${name}, ${date}`}
                behaviour="navigate"
              >
                <View style={styles.rowText}>
                  <NameText style={styles.name}>{name}</NameText>
                  {change.sectionName != null && kindLabel != null && (
                    <Text style={styles.detail}>{kindLabel}</Text>
                  )}
                  {change.relation === 'fork_around' && (
                    <Text style={styles.detail}>{t('sectionHistory.forkAround')}</Text>
                  )}
                  <Text style={styles.detail}>{date}</Text>
                </View>
              </Row>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    frame: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
    },
    body: {
      paddingVertical: spacing.md,
    },
    header: {
      paddingHorizontal: spacing.md,
    },
    rowText: {
      flex: 1,
    },
    name: {
      ...typography.bodyBold,
      color: palette.textPrimary,
    },
    detail: {
      ...typography.bodyCompact,
      color: palette.textSecondary,
      marginTop: spacing.xxs,
    },
  });
