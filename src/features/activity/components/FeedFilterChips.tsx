/**
 * The feed's sport chips.
 *
 * The row never wraps. It is a horizontal scroller, so a fourth chip, a longer
 * translation or a larger font scale pushes the row sideways rather than onto a
 * second line. The feed opens scrolled past a fixed search-section height, and a
 * second chip line puts the first one above that offset, out of view.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';

import { FEED_GROUPS, type FeedGroup } from '../lib/feedActivityGroups';
import { pressable } from '@/shared/ui';

interface FeedFilterChipsProps {
  selected: FeedGroup | null;
  onSelect: (group: FeedGroup) => void;
  isDark: boolean;
}

export function FeedFilterChips({ selected, onSelect, isDark }: FeedFilterChipsProps) {
  const { t } = useTranslation();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.chipScroller}
      contentContainerStyle={styles.chips}
    >
      {FEED_GROUPS.map((group) => (
        <Pressable
          key={group}
          testID={`home-filter-${group.toLowerCase()}`}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === group }}
          style={pressable([
            styles.chip,
            isDark && styles.chipDark,
            selected === group && styles.chipActive,
          ])}
          onPress={() => onSelect(group)}
        >
          <Text
            style={[
              styles.chipText,
              isDark && styles.chipTextDark,
              selected === group && styles.chipTextActive,
            ]}
          >
            {t(`feed.groups.${group.toLowerCase()}`, group)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chipScroller: {
    flexGrow: 0,
  },
  chips: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xsPlus,
    borderRadius: spacing.md,
    backgroundColor: opacity.overlay.light,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextDark: {
    color: darkColors.textSecondary,
  },
  chipTextActive: {
    color: colors.textOnPrimary,
  },
});
