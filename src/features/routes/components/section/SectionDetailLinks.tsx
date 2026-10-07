import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui';
import { colors, darkColors, spacing } from '@/theme';

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
  const { isDark } = useTheme();
  const iconColor = isDark ? darkColors.textPrimary : colors.textPrimary;

  return (
    <View style={styles.group}>
      {hasLaps && (
        <Button
          testID="section-open-laps"
          label={t('sections.laps')}
          variant="secondary"
          icon={<MaterialCommunityIcons name="repeat" size={20} color={iconColor} />}
          onPress={onOpenLaps}
        />
      )}
      <Button
        testID="section-open-history"
        label={
          historyCount > 0
            ? `${t('sectionHistory.title')} · ${historyCount}`
            : t('sectionHistory.title')
        }
        variant="secondary"
        icon={<MaterialCommunityIcons name="history" size={20} color={iconColor} />}
        onPress={onOpenHistory}
      />
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
