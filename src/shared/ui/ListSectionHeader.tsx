/**
 * The header above a group of rows in a grouped list, one look for every
 * settings-family screen.
 *
 * Case is presentation: the token uppercases, so the child is the translation
 * as written. A string uppercased in JavaScript can be spelt out letter by
 * letter by a screen reader, and some locales case differently.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

interface ListSectionHeaderProps {
  children: string;
  /**
   * Off inside a section that already pads itself. On, the header sits at the
   * screen padding above a full-width card, with the gap before a new group.
   */
  inset?: boolean;
  testID?: string;
}

export function ListSectionHeader({ children, inset = true, testID }: ListSectionHeaderProps) {
  const { isDark } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      testID={testID}
      style={[
        styles.header,
        inset && styles.inset,
        { color: isDark ? darkColors.textSecondary : colors.textSecondary },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    ...typography.sectionHeader,
    marginBottom: spacing.sm,
  },
  inset: {
    marginTop: spacing.lg,
    marginHorizontal: layout.screenPadding,
  },
});
