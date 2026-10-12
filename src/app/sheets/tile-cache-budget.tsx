import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { SheetHeader, ToggleButton } from '@/shared/ui';
import { formatFileSize } from '@/shared/format/format';
import { BYTES_PER_BUDGET_MB, TILE_CACHE_BUDGET_CHOICES_MB } from '@/features/maps';
import { colors, darkColors, spacing } from '@/theme';
import { tapBack } from '@/shared/app/navigation';

export interface TileCacheBudgetSheetInput {
  budgetMb: number;
}

function TileCacheBudgetSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<TileCacheBudgetSheetInput, number>();
  const surface = isDark ? darkColors.surface : colors.surface;

  return (
    <View testID="settings-tile-cache-picker" style={[styles.sheet, { backgroundColor: surface }]}>
      <SheetHeader
        title={t('settings.tileCacheLimit')}
        onCancel={() => tapBack()}
        cancelTestID="settings-tile-cache-cancel"
      />
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
  option: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
