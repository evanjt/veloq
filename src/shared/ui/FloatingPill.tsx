/**
 * The floating pill. The status variant is passing status that floats over the
 * page and asks nothing of the athlete: it passes every touch through. The
 * action variant, drawn when the pill has an `onPress`, is a quick return: one
 * button with a trailing chevron. The notice variant, drawn when the pill has
 * an `action` or an `onDismiss`, is a notice over a map: a labelled button and
 * a close at the trailing edge, and every touch beside them goes to the map.
 * A notice the athlete acts on anywhere else is a banner.
 *
 * A lead, a title and an optional detail on the raised surface with the pill
 * shadow, and in dark a 1px card edge, since a shadow alone does not lift a
 * surface off a dark page. The words wrap rather than being cut, so the pill
 * grows taller at large text and the stack it sits in moves the pills below it
 * down.
 */

import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type ColorValue,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  colors,
  controlHeight,
  darkColors,
  iconSize,
  layout,
  motionPresets,
  raised,
  spacing,
  typography,
} from '@/theme';
import { composeAccessibilityLabel } from './accessibilityLabel';
import { Button } from './Button';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import type { NoticeAction } from './NoticeBanner';
import { pressable, pressRipple } from './pressFeedback';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface FloatingPillProps {
  /** The lead glyph, drawn at the small icon size. */
  icon?: IconName;
  /**
   * A lead of the pill's own in place of a glyph, such as a progress ring, or a
   * state dot and a live value. It is never narrower than a glyph.
   */
  lead?: ReactNode;
  title: string;
  /** Colours the title, for a pill that names a state in that state's role. */
  titleColor?: ColorValue;
  detail?: string | null;
  /**
   * Keys the title, so a new value cross-fades in over the old rather than
   * replacing it in one frame.
   */
  titleKey?: string;
  /** Draws the detail in tabular figures, for counts that tick. */
  numericDetail?: boolean;
  /** Spoken once on iOS as the pill appears; Android reads the live region. */
  announcement?: string | null;
  /** Makes the pill the action variant: one button, with a trailing chevron. */
  onPress?: () => void;
  /** The pill's second action, reached by a long press and offered to assistive technology. */
  secondaryAction?: { label: string; onAction: () => void };
  /** What the action pill's button is called, when the title alone does not say it. */
  accessibilityLabel?: string;
  /** Makes the pill the notice variant, with this labelled button at its trailing edge. */
  action?: NoticeAction | undefined;
  /** Makes the pill the notice variant, with a close at its trailing edge. */
  onDismiss?: () => void;
  testID: string;
}

const SECONDARY_ACTION = 'longpress';

export function FloatingPill({
  icon,
  lead,
  title,
  detail,
  titleKey,
  numericDetail = false,
  announcement,
  titleColor,
  onPress,
  secondaryAction,
  accessibilityLabel,
  action,
  onDismiss,
  testID,
}: FloatingPillProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  useAnnounceOnAppear(announcement);
  const surface = [styles.pill, raised('pill', isDark), { backgroundColor: palette.surfaceRaised }];
  // A live region with no name speaks its children, glyphs included, so it is named by its words.
  const spoken = composeAccessibilityLabel(title, detail);

  const content = (
    <>
      <View style={styles.lead}>
        {lead ??
          (icon ? <Icon name={icon} size={iconSize.sm} color={palette.iconSecondary} /> : null)}
      </View>
      <View style={styles.words}>
        <Animated.Text
          key={titleKey}
          {...(titleKey === undefined ? null : motionPresets.message)}
          style={[styles.title, { color: titleColor ?? palette.textPrimary }]}
          testID={`${testID}-title`}
        >
          {title}
        </Animated.Text>
        {detail ? (
          <Animated.Text
            style={[
              styles.detail,
              numericDetail && styles.numeric,
              { color: palette.textSecondary },
            ]}
            testID={`${testID}-detail`}
          >
            {detail}
          </Animated.Text>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    const onAccessibilityAction = (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === SECONDARY_ACTION) secondaryAction?.onAction();
    };
    return (
      <Animated.View {...motionPresets.pill} style={styles.action} pointerEvents="box-none">
        <Pressable
          style={pressable(surface)}
          android_ripple={pressRipple}
          onPress={onPress}
          onLongPress={secondaryAction?.onAction}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityActions={
            secondaryAction ? [{ name: SECONDARY_ACTION, label: secondaryAction.label }] : undefined
          }
          onAccessibilityAction={secondaryAction ? onAccessibilityAction : undefined}
          testID={testID}
        >
          {content}
          <Icon name="chevron-right" size={iconSize.sm} color={palette.iconSecondary} />
        </Pressable>
      </Animated.View>
    );
  }

  if (action || onDismiss) {
    return (
      <Animated.View
        {...motionPresets.pill}
        style={surface}
        pointerEvents="box-none"
        accessibilityLiveRegion="polite"
        accessibilityLabel={spoken}
        testID={testID}
      >
        {content}
        {action ? (
          <Button
            label={action.label}
            onPress={action.onPress}
            variant="ghost"
            size="sm"
            testID={action.testID}
          />
        ) : null}
        {onDismiss ? (
          <IconButton
            accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
            onPress={onDismiss}
            compact
            testID={`${testID}-dismiss`}
          >
            <Icon name="close" size={iconSize.sm} color={palette.iconSecondary} />
          </IconButton>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      {...motionPresets.pill}
      style={surface}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={spoken}
      testID={testID}
    >
      {content}
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
  action: {
    maxWidth: '100%',
  },
  lead: {
    minWidth: iconSize.sm,
    minHeight: iconSize.sm,
    flexDirection: 'row',
    gap: spacing.xs,
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
