import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { spacing } from '@/theme';

interface SectionDetailLinksProps {
  hasLaps: boolean;
  historyCount: number;
  onOpenLaps: () => void;
  onOpenHistory: () => void;
}

export function SectionDetailLinks({
  hasLaps,
  historyCount,
  onOpenLaps,
  onOpenHistory,
}: SectionDetailLinksProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.group}>
      {hasLaps ? (
        <Button
          testID="section-open-laps"
          label={t('sections.laps')}
          variant="secondary"
          icon="repeat"
          onPress={onOpenLaps}
        />
      ) : null}
      <Button
        testID="section-open-history"
        label={
          historyCount > 0
            ? `${t('sectionHistory.title')} · ${historyCount}`
            : t('sectionHistory.title')
        }
        variant="secondary"
        icon="history"
        onPress={onOpenHistory}
      />
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
