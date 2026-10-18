import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, iconSize, layout, spacing, typography, themePalette } from '@/theme';
import type { FrequentSection } from '@/types';
import { sectionActionChips } from '../../lib/sectionActionChips';
import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { FitText } from '@/shared/ui/FitText';

/**
 * The section page's row under the map: a labelled Edit bounds, Accept while the
 * section is offered, and the section's state chips. Delete or remove and
 * rematch are rarer and live in the header's overflow menu.
 */
export interface SectionActionRowProps {
  isDark: boolean;
  section: FrequentSection;
  startTrim: () => void;
  handleAcceptSection: () => void;
  /** The stored version the section is pinned to, if any. */
  pinnedVersion?: number | null;
  /** Some laps of some activity are excluded, not the whole activity. */
  partlyExcluded?: boolean;
}

export function SectionActionRow({
  isDark,
  section,
  startTrim,
  handleAcceptSection,
  pinnedVersion = null,
  partlyExcluded = false,
}: SectionActionRowProps) {
  const { t } = useTranslation();
  const chips = sectionActionChips({
    sectionType: section.sectionType,
    isUserDefined: section.isUserDefined === true,
    pinnedVersion,
  });

  return (
    <View testID="section-action-row" style={styles.actionRow}>
      <Button
        testID="section-trim-button"
        variant="secondary"
        size="sm"
        label={t('sections.editBounds')}
        onPress={startTrim}
        icon="content-cut"
      />
      <View style={styles.actionChips}>
        {partlyExcluded ? (
          <View
            testID="section-partly-excluded"
            style={[
              styles.actionPill,
              { backgroundColor: isDark ? darkColors.surface : colors.surface },
            ]}
          >
            <Icon
              name="eye-off-outline"
              size={iconSize.sm}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <FitText
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.textSecondary : colors.textSecondary },
              ]}
            >
              {t('sections.partlyExcluded')}
            </FitText>
          </View>
        ) : null}
        {chips.pinned ? (
          <View
            testID="section-pinned-version"
            style={[
              styles.actionPill,
              { backgroundColor: isDark ? darkColors.surface : colors.surface },
            ]}
          >
            <Icon name="pin" size={iconSize.sm} color={themePalette(isDark).actionPrimary} />
            <FitText
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.actionLink : colors.actionLink },
              ]}
            >
              {t('sections.pinned')}
            </FitText>
          </View>
        ) : null}
        {chips.accept === 'accepted' && (
          <View
            testID="section-accepted"
            style={[
              styles.actionPill,
              { backgroundColor: isDark ? darkColors.surface : colors.surface },
            ]}
          >
            <Icon
              name="check-circle"
              size={iconSize.sm}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <FitText
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.textSecondary : colors.textSecondary },
              ]}
            >
              {t('sections.accepted')}
            </FitText>
          </View>
        )}
        {chips.accept === 'offer' && (
          <Button
            variant="secondary"
            size="sm"
            label={t('sections.acceptSection')}
            onPress={handleAcceptSection}
            icon="check-circle-outline"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionChips: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  actionPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
    borderRadius: layout.borderRadius,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  actionPillText: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
});
