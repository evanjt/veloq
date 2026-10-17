import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import type { FrequentSection } from '@/types';
import { sectionActionChips } from '../../lib/sectionActionChips';
import { Button, IconButton } from '@/shared/ui';

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
        icon={
          <MaterialCommunityIcons
            name="content-cut"
            size={iconSize.sm}
            color={isDark ? darkColors.textPrimary : colors.textSecondary}
          />
        }
      />
      {section.sectionType === 'custom' ? (
        <IconButton
          variant="secondary"
          accessibilityLabel={t('sections.deleteSection')}
          onPress={handleDeleteSection}
        >
          <MaterialCommunityIcons name="delete-outline" size={iconSize.sm} color={colors.error} />
        </IconButton>
      ) : (
        <IconButton
          variant="secondary"
          accessibilityLabel={
            isSectionDisabled ? t('sections.restoreSection') : t('sections.removeSection')
          }
          onPress={handleToggleDisable}
        >
          <MaterialCommunityIcons
            name={isSectionDisabled ? 'undo' : 'minus-circle-outline'}
            size={iconSize.sm}
            color={
              isSectionDisabled
                ? colors.success
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
          <MaterialCommunityIcons
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
            <MaterialCommunityIcons
              name="eye-off-outline"
              size={iconSize.sm}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.textSecondary : colors.textSecondary },
              ]}
            >
              {t('sections.partlyExcluded')}
            </Text>
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
            <MaterialCommunityIcons name="pin" size={iconSize.sm} color={colors.primary} />
            <Text
              numberOfLines={1}
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.linkTeal : colors.linkTeal },
              ]}
            >
              {t('sections.pinned')}
            </Text>
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
            <MaterialCommunityIcons
              name="check-circle"
              size={iconSize.sm}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.textSecondary : colors.textSecondary },
              ]}
            >
              {t('sections.accepted')}
            </Text>
          </View>
        )}
        {chips.accept === 'offer' && (
          <Button
            variant="secondary"
            size="sm"
            label={t('sections.acceptSection')}
            onPress={handleAcceptSection}
            icon={
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={iconSize.sm}
                color={colors.primary}
              />
            }
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
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
