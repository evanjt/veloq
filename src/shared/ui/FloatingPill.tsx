/**
 * The status pill: passing status that floats over the page and asks nothing of
 * the athlete. Anything the athlete has to act on is a banner instead.
 *
 * A lead, a title and an optional detail on the raised surface with the pill
 * shadow, and in dark a 1px card edge, since a shadow alone does not lift a
 * surface off a dark page. The words wrap rather than being cut, so the pill
 * grows taller at large text and the stack it sits in moves the pills below it
 * down. It passes every touch through.
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import {
  colors,
  controlHeight,
  darkColors,
  iconSize,
  layout,
  motionPresets,
  shadows,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** A ground and ink a pill draws instead of the raised surface, every word in the ink. */
export interface PillFill {
  ground: string;
  ink: string;
}

interface FloatingPillProps {
  /** The lead glyph, drawn at the small icon size. */
  icon?: IconName;
  /** A lead of the pill's own, such as a progress ring, in place of a glyph. */
  lead?: ReactNode;
  title: string;
  detail?: string | null;
  /**
   * Keys the title, so a new value cross-fades in over the old rather than
   * replacing it in one frame.
   */
  titleKey?: string;
  /** Draws the detail in tabular figures, for counts that tick. */
  numericDetail?: boolean;
  fill?: PillFill;
  /** Spoken once on iOS as the pill appears; Android reads the live region. */
  announcement?: string | null;
  testID: string;
}

export function FloatingPill({
  icon,
  lead,
  title,
  detail,
  titleKey,
  numericDetail = false,
  fill,
  announcement,
  testID,
}: FloatingPillProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  useAnnounceOnAppear(announcement);

  const ground = fill?.ground ?? palette.surfaceRaised;
  const titleInk = fill?.ink ?? palette.textPrimary;
  const detailInk = fill?.ink ?? palette.textSecondary;
  const edge = isDark && !fill ? styles.edge : null;

  return (
    <Animated.View
      {...motionPresets.pill}
      style={[styles.pill, shadows.pill, edge, { backgroundColor: ground }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <View style={styles.lead}>
        {lead ??
          (icon ? (
            <MaterialCommunityIcons name={icon} size={iconSize.sm} color={palette.iconSecondary} />
          ) : null)}
      </View>
      <View style={styles.words}>
        <Animated.Text
          key={titleKey}
          {...(titleKey === undefined ? null : motionPresets.message)}
          style={[styles.title, { color: titleInk }]}
          testID={`${testID}-title`}
        >
          {title}
        </Animated.Text>
        {detail ? (
          <Animated.Text
            style={[styles.detail, numericDetail && styles.numeric, { color: detailInk }]}
            testID={`${testID}-detail`}
          >
            {detail}
          </Animated.Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    maxWidth: '100%',
    minHeight: controlHeight.buttonSm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.smPlus,
    borderRadius: layout.borderRadiusFull,
  },
  edge: {
    borderWidth: stroke.one,
    borderColor: darkColors.cardEdge,
  },
  lead: {
    width: iconSize.sm,
    height: iconSize.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The title and the detail sit on one line while they fit, and the detail
  // drops to its own line, whole, when they do not.
  words: {
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing.xs,
  },
  title: {
    ...typography.bodyCompactBold,
    flexShrink: 1,
  },
  detail: {
    ...typography.caption,
    flexShrink: 0,
    maxWidth: '100%',
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
