/**
 * The banner in the top slot, and the only one.
 *
 * A banner appears on its own, while the athlete is doing something else, so it
 * is a live region on Android and speaks its title on iOS as it appears: a
 * failure interrupts, anything else waits its turn. It pads the status bar
 * only when it is the topmost in the slot, by the inset the device reports,
 * and records the height it drew so a pill floating under the status bar sits
 * below it rather than over it.
 *
 * It is one row: the tone's icon, the title and any detail, then its action
 * and an icon close at the trailing edge. Only past the large-text cap does
 * the row stack, with the controls under the text. The close is labelled
 * Close, and the English default covers the launch where the language
 * initialiser is the one that failed and the translator has no bundle to read.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useBannerTopPadding } from '@/shared/app/TopSafeAreaContext';
import { useTopBannerHeights, type ShownBanner } from '@/shared/app/topBanner';
import {
  colors,
  controlHeight,
  darkColors,
  iconSize,
  motionPresets,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';
import { useLargeText } from './useLargeText';

/**
 * A failure, a notice the athlete may act on, a state they chose, or a wait
 * that ends on its own.
 */
export type NoticeTone = 'error' | 'warning' | 'info' | 'neutral';

export interface NoticeAction {
  label: string;
  onPress: () => void;
  testID: string;
}

interface NoticeBannerProps {
  /** The banner's place in the top slot, which decides whether it pads the status bar. */
  slot: ShownBanner;
  tone: NoticeTone;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  /** Lines under the title. */
  detail?: readonly string[];
  actions?: readonly NoticeAction[];
  onDismiss?: () => void;
  testID: string;
}

export interface NoticePalette {
  bg: string;
  /** An edge under the ground, for the one tone whose ground is the page colour. */
  border?: string;
  text: string;
  subtext: string;
  icon: string;
}

/**
 * Each tone is its status tint with the body ink on it and the tone's own
 * text colour as the icon, so a failure, a caution and a notice differ by hue
 * and each still pairs its colour with an icon and words. Neutral is the
 * surface, edged so it parts from the page under it. The pairs are measured in
 * `TINT_GROUNDS`.
 */
export function noticePalette(tone: NoticeTone, isDark: boolean): NoticePalette {
  const p = isDark ? darkColors : colors;
  const ink = { text: p.textPrimary, subtext: p.textSecondary };
  const grounds: Record<NoticeTone, Omit<NoticePalette, 'text' | 'subtext'>> = {
    error: { bg: p.errorBg, icon: p.errorDeep },
    warning: { bg: p.warningBg, icon: p.warningAmber },
    info: { bg: p.infoBg, icon: p.infoText },
    neutral: { bg: p.surface, border: p.border, icon: p.textSecondary },
  };
  return { ...grounds[tone], ...ink };
}

export function NoticeBanner({
  slot,
  tone,
  icon,
  title,
  detail = [],
  actions = [],
  onDismiss,
  testID,
}: NoticeBannerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const paddingTop = useBannerTopPadding(slot);
  const setHeight = useTopBannerHeights((s) => s.setHeight);
  const ground = noticePalette(tone, isDark);
  const stacked = useLargeText();

  useAnnounceOnAppear([title, ...detail].join('. '));

  useEffect(() => () => setHeight(slot, null), [slot, setHeight]);

  const onLayout = (event: LayoutChangeEvent) => setHeight(slot, event.nativeEvent.layout.height);
  const hasControls = actions.length > 0 || onDismiss !== undefined;

  return (
    <Animated.View {...motionPresets.banner}>
      <View
        testID={testID}
        onLayout={onLayout}
        accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
        style={[
          styles.container,
          { paddingTop, backgroundColor: ground.bg },
          ground.border !== undefined && {
            borderBottomWidth: stroke.hairline,
            borderBottomColor: ground.border,
          },
        ]}
      >
        <View testID={`${testID}-content`} style={[styles.content, stacked && styles.stacked]}>
          <View style={styles.headline}>
            <MaterialCommunityIcons name={icon} size={iconSize.sm} color={ground.icon} />
            <View style={styles.text}>
              <Text style={[styles.title, { color: ground.text }]}>{title}</Text>
              {detail.map((line, index) => (
                <Text key={index} style={[styles.detail, { color: ground.subtext }]}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
          {hasControls ? (
            <View style={styles.controls}>
              {actions.map((action) => (
                <Button
                  key={action.label}
                  label={action.label}
                  onPress={action.onPress}
                  variant="secondary"
                  size="sm"
                  testID={action.testID}
                />
              ))}
              {onDismiss ? (
                <IconButton
                  accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
                  onPress={onDismiss}
                  compact
                  testID={`${testID}-dismiss`}
                >
                  <MaterialCommunityIcons name="close" size={iconSize.sm} color={ground.subtext} />
                </IconButton>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    minHeight: controlHeight.buttonSm + spacing.sm * 2,
  },
  stacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  headline: {
    flex: 1,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
});
