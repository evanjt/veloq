import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { IconButton, ToggleButton } from '@/shared/ui';
import { formatFileSize } from '@/shared/format/format';
import { BYTES_PER_BUDGET_MB, TILE_CACHE_BUDGET_CHOICES_MB } from '@/features/maps';
import { colors, darkColors, spacing, typography } from '@/theme';
import { tapBack } from '@/shared/app/navigation';

export interface TileCacheBudgetSheetInput {
  budgetMb: number;
}

function TileCacheBudgetSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<TileCacheBudgetSheetInput, number>();
  const surface = isDark ? darkColors.surface : colors.surface;
  const primary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const secondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View testID="settings-tile-cache-picker" style={[styles.sheet, { backgroundColor: surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: primary }]}>{t('settings.tileCacheLimit')}</Text>
        <IconButton onPress={() => tapBack()} accessibilityLabel={t('common.close')}>
          <MaterialCommunityIcons name="close" size={24} color={secondary} />
        </IconButton>
      </View>
      {TILE_CACHE_BUDGET_CHOICES_MB.map((mb) => {
        const selected = mb === input?.budgetMb;
        return (
          <ToggleButton
            key={mb}
            testID={`settings-tile-cache-choice-${mb}`}
            label={formatFileSize(mb * BYTES_PER_BUDGET_MB)}
            selected={selected}
            style={styles.option}
            onPress={() => resolve(mb)}
          />
        );
      })}
    </View>
  );
}

export default withScreenBoundary(TileCacheBudgetSheetContent, 'Tile cache budget');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
  },
  option: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
