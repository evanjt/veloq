/**
 * A notice inside a screen, beside what it is about: a failure, a caution, a
 * notice or a state, drawn from the banner's tone palette so the two cannot
 * show one tone two ways. The banner is the one in the top slot; this is
 * every other.
 *
 * It is the tone's icon, a title and any detail, then one trailing control: an
 * action, a chevron when the whole notice opens something, and a close.
 * Anything with more than one way out, such as a failed save, puts its
 * controls under the text. It sits at the card radius, since the design guide
 * gives an in-screen notice no radius of its own.
 *
 * It is spoken as it appears, a failure interrupting and anything else waiting
 * its turn, unless its host speaks for it.
 */

import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { iconSize, layout, spacing, stroke, typography } from '@/theme';
import { IconButton } from './IconButton';
import { noticePalette, type NoticeTone } from './noticePalette';
import { pressable, pressRipple } from './pressFeedback';
import { joinStatusMessage } from './StatusLine';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';

type DetailLine = string | null | undefined | false;

export interface InlineNoticeProps {
  tone: NoticeTone;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  /** Lines under the title. Empty lines drop out. */
  detail?: DetailLine | readonly DetailLine[];
  /** The one control on the title's row, such as Allow or Open settings. */
  action?: ReactNode;
  /** Controls under the text, for a notice with more than one way out. */
  children?: ReactNode;
  /** Makes the whole notice a link, drawn with a chevron. */
  onPress?: () => void;
  onDismiss?: () => void;
  /** False when the host speaks the notice itself, as a status slot does. */
  announce?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function InlineNotice({
  tone,
  icon,
  title,
  detail,
  action,
  children,
  onPress,
  onDismiss,
  announce = true,
  style,
  testID,
}: InlineNoticeProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const ground = noticePalette(tone, isDark);
  const lines = (Array.isArray(detail) ? detail : [detail]).filter(
    (line): line is string => typeof line === 'string' && line.length > 0
  );
  const spoken = joinStatusMessage([title, ...lines]);
  useAnnounceOnAppear(announce ? spoken : null);

  const groundStyle: StyleProp<ViewStyle> = [
    styles.container,
    { backgroundColor: ground.bg },
    ground.border !== undefined && { borderWidth: stroke.hairline, borderColor: ground.border },
    style,
  ];

  const content = (
    <>
      <View style={styles.row}>
        <MaterialCommunityIcons name={icon} size={iconSize.sm} color={ground.icon} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: ground.text }]}>{title}</Text>
          {lines.map((line, index) => (
            <Text key={index} style={[styles.detail, { color: ground.subtext }]}>
              {line}
            </Text>
          ))}
        </View>
        {action}
        {onPress ? (
          <MaterialCommunityIcons name="chevron-right" size={iconSize.sm} color={ground.subtext} />
        ) : null}
        {onDismiss ? (
          <IconButton
            accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
            onPress={onDismiss}
            compact
            testID={testID ? `${testID}-dismiss` : undefined}
          >
            <MaterialCommunityIcons name="close" size={iconSize.sm} color={ground.subtext} />
          </IconButton>
        ) : null}
      </View>
      {children ? <View style={styles.controls}>{children}</View> : null}
    </>
  );

  const liveRegion = announce ? (tone === 'error' ? 'assertive' : 'polite') : undefined;

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        style={pressable(groundStyle)}
        android_ripple={pressRipple}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={spoken ?? title}
        accessibilityLiveRegion={liveRegion}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={groundStyle} accessibilityLiveRegion={liveRegion}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.bodySmallBold,
  },
  detail: {
    ...typography.caption,
  },
  controls: {
    gap: spacing.sm,
  },
});
