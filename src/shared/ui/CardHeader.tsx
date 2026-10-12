/**
 * The title row of a card.
 *
 * Every card titled itself, at sizes from 11 to 18 and in two weights, some
 * uppercase and grey, so peer cards on one screen read as different ranks and
 * none was a heading. This is the one card title: the `cardTitle` type role in
 * the primary text colour, sentence case as written, carrying the header role
 * so a screen reader can move card to card. A control or a figure that belongs
 * to the title goes at the trailing edge as the accessory, and a caption that
 * qualifies it goes under it as the subtitle.
 *
 * `Card` draws it from its `title`. A card a feature lays out itself, such as a
 * chart placed in a container its screen owns, renders it directly.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { spacing, themePalette, typography } from '@/theme';

export interface CardHeaderProps {
  title: string;
  /** A caption under the title that qualifies it, such as the span it covers. */
  subtitle?: string | undefined;
  /** A control or figure at the trailing edge: a picker, a count, a value. */
  accessory?: React.ReactNode;
  testID?: string | undefined;
}

export function CardHeader({ title, subtitle, accessory, testID }: CardHeaderProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.titleBlock}>
        <Text
          testID={testID ? `${testID}-title` : undefined}
          accessibilityRole="header"
          style={[styles.title, { color: palette.textPrimary }]}
        >
          {title}
        </Text>
        {subtitle != null && (
          <Text
            testID={testID ? `${testID}-subtitle` : undefined}
            style={[styles.subtitle, { color: palette.textSecondary }]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  titleBlock: {
    flexShrink: 1,
  },
  title: {
    ...typography.cardTitle,
  },
  subtitle: {
    ...typography.caption,
  },
});
