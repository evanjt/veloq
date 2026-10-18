import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { iconSize, layout, spacing, typography, themePalette } from '@/theme';
import type { SectionActionChips } from '../../lib/sectionActionChips';
import { Icon } from '@/shared/ui/Icon';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { FitText } from '@/shared/ui/FitText';
import type { IconName } from '@/shared/ui/Icon';

export interface SectionStatusLineProps {
  isDark: boolean;
  /** Which kept state shows, as `sectionActionChips` decides it. */
  chips: SectionActionChips;
  /** Some laps of some activity are excluded, not the whole activity. */
  partlyExcluded?: boolean | undefined;
}

/**
 * The section's kept state at the foot of its summary: Partly excluded, Pinned and Accepted, each
 * with a glyph of its own. Nothing when none of them holds.
 */
export function SectionStatusLine({
  isDark,
  chips,
  partlyExcluded = false,
}: SectionStatusLineProps) {
  const { t } = useTranslation();
  const palette = themePalette(isDark);
  const pills: { testID: string; icon: IconName; iconColor: string; text: string; ink: string }[] =
    [];
  if (partlyExcluded) {
    pills.push({
      testID: 'section-partly-excluded',
      icon: 'eye-off-outline',
      iconColor: palette.textSecondary,
      text: t('sections.partlyExcluded'),
      ink: palette.textSecondary,
    });
  }
  if (chips.pinned) {
    pills.push({
      testID: 'section-pinned-version',
      icon: 'pin',
      iconColor: palette.actionPrimary,
      text: t('sections.pinned'),
      ink: palette.actionLink,
    });
  }
  if (chips.accept === 'accepted') {
    pills.push({
      testID: 'section-accepted',
      icon: 'check-circle',
      iconColor: palette.textSecondary,
      text: t('sections.accepted'),
      ink: palette.textSecondary,
    });
  }
  if (pills.length === 0) return null;

  return (
    <View testID="section-status-line" style={styles.line}>
      {pills.map((pill) => (
        <View
          key={pill.testID}
          testID={pill.testID}
          style={[styles.pill, { backgroundColor: palette.surface }]}
        >
          <Icon name={pill.icon} size={iconSize.sm} color={pill.iconColor} />
          <FitText
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.pillText, { color: pill.ink }]}
          >
            {pill.text}
          </FitText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
    borderRadius: layout.borderRadius,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pillText: {
    ...typography.captionBold,
  },
});
