import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { ToggleButton } from '@/shared/ui';
import { SMOOTHING_PRESETS, getSmoothingPresetLabel } from '@/shared/math/smoothing';
import type { SmoothingWindow } from '@/shared/math/smoothing';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

/** The wellness smoothing picker, a sheet route opened with `openSheet` and answered with the chosen window. */

export interface SmoothingSheetInput {
  window: SmoothingWindow;
}

function SmoothingSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<SmoothingSheetInput, SmoothingWindow>();
  const current = input?.window;

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: textPrimary }]}>
        {t('wellness.smoothingTitle' as never)}
      </Text>
      <Text style={[styles.description, { color: textSecondary }]}>
        {t('wellness.smoothingDescription' as never)}
      </Text>
      <View style={styles.options}>
        {SMOOTHING_PRESETS.map((preset) => {
          const isSelected = current === preset.value;
          return (
            <ToggleButton
              key={String(preset.value)}
              testID={`smoothing-option-${preset.value}`}
              label={getSmoothingPresetLabel(preset.value, t as never)}
              selected={isSelected}
              onPress={() => resolve(preset.value)}
            />
          );
        })}
      </View>
      <Text style={[styles.hint, { color: textSecondary }]}>
        {t('wellness.smoothingHint' as never)}
      </Text>
    </View>
  );
}

export default withScreenBoundary(SmoothingSheetContent, 'Smoothing');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    padding: layout.screenPadding,
  },
  title: {
    ...typography.cardTitle,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
