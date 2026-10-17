import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { openExternal } from '@/shared/app/openExternal';
import { colors, darkColors, layout, opacity, spacing, typography, stroke } from '@/theme';
import { Button } from './Button';
import { Card } from './Card';

/** One line of an explanation: an optional name in bold, then what it means. */
export interface ExplanationRow {
  key: string;
  label?: string | undefined;
  text: string;
  /** The colour the screen draws this metric in, as a dot before the line. */
  dotColor?: string | undefined;
}

export interface ExplanationLink {
  key: string;
  label: string;
  url: string;
}

export interface Explanation {
  title: string;
  rows: readonly ExplanationRow[];
}

interface ExplanationCardProps extends Explanation {
  /** Further reading, under a heading of its own below the rows. */
  links?: { heading: string; items: readonly ExplanationLink[] } | undefined;
  testID?: string | undefined;
}

/**
 * The card a tab ends with: how its numbers are found, what each kind means and
 * where they come from.
 */
export function ExplanationCard({ title, rows, links, testID }: ExplanationCardProps) {
  const { isDark } = useTheme();
  return (
    <View testID={testID} style={styles.frame}>
      <Card variant="raised">
        <Text style={[styles.title, isDark && styles.titleDark]}>{title}</Text>

        {rows.map((row) => (
          <View key={row.key} style={styles.row}>
            {row.dotColor ? <View style={[styles.dot, { backgroundColor: row.dotColor }]} /> : null}
            <Text style={[styles.text, isDark && styles.textDark]}>
              {row.label ? (
                <>
                  <Text style={[styles.highlight, isDark && styles.highlightDark]}>
                    {row.label}
                  </Text>{' '}
                </>
              ) : null}
              {row.text}
            </Text>
          </View>
        ))}

        {links ? (
          <View style={[styles.links, isDark && styles.linksDark]}>
            <Text style={[styles.linksHeading, isDark && styles.linksHeadingDark]}>
              {links.heading}
            </Text>
            {links.items.map((link) => (
              <Button
                key={link.key}
                label={link.label}
                variant="ghost"
                size="sm"
                onPress={() => {
                  void openExternal(link.url);
                }}
              />
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusXs,
    marginTop: spacing.xs,
    marginRight: spacing.xs,
  },
  text: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  highlight: {
    ...typography.captionBold,
  },
  highlightDark: {
    color: darkColors.textPrimary,
  },
  links: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: stroke.one,
    borderTopColor: opacity.overlay.light,
  },
  linksDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  linksHeading: {
    ...typography.sectionHeader,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  linksHeadingDark: {
    color: darkColors.textSecondary,
  },
});
