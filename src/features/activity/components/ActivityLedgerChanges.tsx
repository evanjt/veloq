import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { ActivityLedgerChange } from 'veloqrs';
import { useMetricSystem } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { formatFullDate } from '@/shared/format/format';
import { changeCopy, ledgerDate } from '@/features/routes';
import { Card, CardHeader, Row } from '@/shared/ui';
import { spacing, typography, themedStyles, type Palette } from '@/theme';
import { NameText } from '@/shared/ui/NameText';

interface ActivityLedgerChangesProps {
  changes: readonly ActivityLedgerChange[];
  isDark: boolean;
}

/**
 * The section changes whose ledger rows name this activity, worded as the
 * section's own history words them. A ride followed a change, it did not cause
 * one.
 */
export function ActivityLedgerChanges({ changes, isDark }: ActivityLedgerChangesProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  if (changes.length === 0) return null;
  const styles = themedStyles(makeStyles, isDark);

  return (
    <View style={styles.frame} testID="activity-ledger-changes">
      <Card variant="flat" padding="none">
        <View style={styles.body}>
          <View style={styles.header}>
            <CardHeader title={t('sectionHistory.changesTitle')} />
          </View>
          {changes.map((change) => {
            const headline = changeCopy(t, change, isMetric).headline;
            const name = change.sectionName ?? headline ?? change.kind;
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
                  {change.sectionName != null && headline != null && (
                    <Text style={styles.detail}>{headline}</Text>
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
