import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, iconSize, layout, spacing, typography, themePalette } from '@/theme';
import type { FrequentSection } from '@/types';
import { sectionActionChips } from '../../lib/sectionActionChips';
import { SectionActionGlyph } from '../SectionSwipeAction';
import { Button, IconButton } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { FitText } from '@/shared/ui/FitText';

export interface SectionActionRowProps {
  isDark: boolean;
  isSectionDisabled: boolean;
  isRematching: boolean;
  /** Detection is held, so a rematch would be refused. */
  isRematchHeld?: boolean;
  section: FrequentSection;
  startTrim: () => void;
  handleDeleteSection: () => void;
  handleToggleDisable: () => void;
  handleRematchActivities?: () => void;
  handleAcceptSection: () => void;
  /** The stored version the section is pinned to, if any. */
  pinnedVersion?: number | null;
  /** Some laps of some activity are excluded, not the whole activity. */
  partlyExcluded?: boolean;
}

export function SectionActionRow({
  isDark,
  isSectionDisabled,
  isRematching,
  isRematchHeld = false,
  section,
  startTrim,
  handleDeleteSection,
  handleToggleDisable,
  handleRematchActivities,
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
      {section.sectionType === 'custom' ? (
        <IconButton
          variant="secondary"
          accessibilityLabel={t('sections.deleteSection')}
          onPress={handleDeleteSection}
        >
          <SectionActionGlyph kind="delete" size={iconSize.sm} color={colors.errorText} />
        </IconButton>
      ) : (
        <IconButton
          variant="secondary"
          accessibilityLabel={
            isSectionDisabled ? t('sections.restoreSection') : t('sections.removeSection')
          }
          onPress={handleToggleDisable}
        >
          <SectionActionGlyph
            kind={isSectionDisabled ? 'restore' : 'remove'}
            size={iconSize.sm}
            color={
              isSectionDisabled
                ? colors.successText
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
        </IconButton>
      )}
      {handleRematchActivities ? (
        <IconButton
          variant="secondary"
          accessibilityLabel={t('sections.rematchActivities')}
          onPress={handleRematchActivities}
          disabled={isRematching || isRematchHeld}
        >
          <Icon
            name={isRematching ? 'loading' : 'refresh'}
            size={iconSize.sm}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </IconButton>
      ) : null}
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
