import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme';
import type { FrequentSection } from '@/types';
import { styles } from './SectionDetail.styles';

export interface SectionActionRowProps {
  isDark: boolean;
  isCustomId: boolean;
  isSectionDisabled: boolean;
  isRematching: boolean;
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
  isCustomId,
  isSectionDisabled,
  isRematching,
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

  return (
    <View style={styles.actionRow}>
      <TouchableOpacity
        testID="section-trim-button"
        style={[
          styles.actionPill,
          { backgroundColor: isDark ? darkColors.surface : colors.surface },
        ]}
        onPress={startTrim}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name="content-cut"
          size={16}
          color={isDark ? darkColors.textPrimary : colors.textSecondary}
        />
        <Text style={[styles.actionPillText, isDark && { color: darkColors.textPrimary }]}>
          {t('sections.editBounds')}
        </Text>
      </TouchableOpacity>
      {isCustomId ? (
        <TouchableOpacity
          style={[
            styles.actionCircle,
            { backgroundColor: isDark ? darkColors.surface : colors.surface },
          ]}
          onPress={handleDeleteSection}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="delete-outline" size={16} color={colors.error} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.actionCircle,
            { backgroundColor: isDark ? darkColors.surface : colors.surface },
          ]}
          onPress={handleToggleDisable}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name={isSectionDisabled ? 'undo' : 'delete-outline'}
            size={16}
            color={
              isSectionDisabled
                ? colors.success
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
        </TouchableOpacity>
      )}
      {handleRematchActivities && (
        <TouchableOpacity
          style={[
            styles.actionCircle,
            { backgroundColor: isDark ? darkColors.surface : colors.surface },
          ]}
          onPress={handleRematchActivities}
          activeOpacity={0.7}
          disabled={isRematching}
        >
          <MaterialCommunityIcons
            name={isRematching ? 'loading' : 'refresh'}
            size={16}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      )}
      {/* Accept/Pin chip - inline with action buttons */}
      {section &&
        section.sectionType === 'auto' &&
        !isCustomId &&
        (section.isUserDefined ? (
          <View
            style={[
              styles.actionPill,
              {
                backgroundColor: isDark ? darkColors.surface : colors.surface,
                marginLeft: 'auto',
              },
            ]}
          >
            <MaterialCommunityIcons
              name="pin"
              size={14}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <Text
              style={[
                styles.actionPillText,
                { color: isDark ? darkColors.textSecondary : colors.textSecondary },
              ]}
            >
              {t('sections.accepted')}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.actionPill,
              {
                backgroundColor: isDark ? darkColors.surface : colors.surface,
                marginLeft: 'auto',
              },
            ]}
            onPress={handleAcceptSection}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="pin-outline" size={14} color={colors.primary} />
            <Text style={[styles.actionPillText, { color: colors.primary }]}>
              {t('sections.acceptSection')}
              {partlyExcluded && (
                <View
                  testID="section-partly-excluded"
                  style={[
                    styles.actionPill,
                    { backgroundColor: isDark ? darkColors.surface : colors.surface },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="eye-off-outline"
                    size={14}
                    color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.actionPillText,
                      { color: isDark ? darkColors.textSecondary : colors.textSecondary },
                    ]}
                  >
                    {t('sections.partlyExcluded')}
                  </Text>
                </View>
              )}
              {pinnedVersion != null && (
                <View
                  testID="section-pinned-version"
                  style={[
                    styles.actionPill,
                    { backgroundColor: isDark ? darkColors.surface : colors.surface },
                  ]}
                >
                  <MaterialCommunityIcons name="pin" size={14} color={colors.primary} />
                  <Text style={[styles.actionPillText, { color: colors.primary }]}>
                    {t('sections.pinned')}
                  </Text>
                </View>
              )}
            </Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}
