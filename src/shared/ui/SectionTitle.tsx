/**
 * The title of a screen, or of a part of one, that stands outside a card, a
 * list group or a sheet.
 *
 * It carries the header role, so the headings rotor and heading navigation can
 * skim a long screen by it. A card's title, a grouped list's header and a
 * sheet's title each have their own component; this is the title for the rest.
 */

import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, typography } from '@/theme';

interface SectionTitleProps {
  children: string;
  /** `screen` for the one title a screen opens on, `section` for a part of it. */
  level?: 'screen' | 'section';
  align?: 'start' | 'center';
  /** Spacing around the title. Size, weight and colour come from the level. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function SectionTitle({
  children,
  level = 'section',
  align = 'start',
  style,
  testID,
}: SectionTitleProps) {
  const { isDark } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      testID={testID}
      style={[
        level === 'screen' ? styles.screen : styles.section,
        align === 'center' && styles.centred,
        { color: isDark ? darkColors.textPrimary : colors.textPrimary },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...typography.screenTitle,
  },
  section: {
    ...typography.sectionTitle,
  },
  centred: {
    textAlign: 'center',
  },
});
