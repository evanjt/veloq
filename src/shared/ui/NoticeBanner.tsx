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
 * Its actions are the shared `Button`, and a dismiss, when it has one, is
 * labelled Close. The English default covers the launch where the language
 * initialiser is the one that failed and the translator has no bundle to read.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useBannerTopPadding } from '@/shared/app/TopSafeAreaContext';
import { useTopBannerHeights, type ShownBanner } from '@/shared/app/topBanner';
import {
  amberBanner,
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  spacing,
  typography,
} from '@/theme';
import { Button } from './Button';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';

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

interface Palette {
  bg: string;
  text: string;
  subtext: string;
}

/**
 * Failures and notices draw on amber. The info tone takes the brand blue with
 * dark ink on the light fill and white on the dark one: white on `brand.blue`
 * is 2.96:1 and dark ink on `brand.blueDark` 3.93:1, so neither ink carries
 * both fills. Measured 2026-09-15: dark ink on blue 5.99:1, white on blueDark
 * 4.51:1, and the subtitle's dark ink at 0.85 is 4.78:1. On the dark fill white
 * has no headroom to give, so the subtitle goes full strength. The neutral tone
 * is the theme's own surface and text, since nothing is wrong.
 */
function palette(tone: NoticeTone, isDark: boolean): Palette {
  if (tone === 'neutral') {
    return isDark
      ? { bg: darkColors.surface, text: darkColors.textPrimary, subtext: darkColors.textSecondary }
      : { bg: colors.surface, text: colors.textPrimary, subtext: colors.textSecondary };
  }
  if (tone !== 'info') return isDark ? amberBanner.dark : amberBanner.light;
  return isDark
    ? { bg: brand.blueDark, text: colors.textOnDark, subtext: ink.white }
    : {
        bg: brand.blue,
        text: colors.textOnBright,
        subtext: colorWithOpacity(colors.textOnBright, 0.85),
      };
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
  const ground = palette(tone, isDark);

  useAnnounceOnAppear([title, ...detail].join('. '));

  useEffect(() => () => setHeight(slot, null), [slot, setHeight]);

  const onLayout = (event: LayoutChangeEvent) => setHeight(slot, event.nativeEvent.layout.height);
  const hasControls = actions.length > 0 || onDismiss !== undefined;

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View
        testID={testID}
        onLayout={onLayout}
        accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
        style={[styles.container, { paddingTop, backgroundColor: ground.bg }]}
      >
        <View testID={`${testID}-content`} style={styles.content}>
          <View style={styles.headline}>
            <MaterialCommunityIcons name={icon} size={iconSize.sm} color={ground.text} />
            <Text style={[styles.title, { color: ground.text }]}>{title}</Text>
          </View>
          {detail.map((line, index) => (
            <Text key={index} style={[styles.detail, { color: ground.subtext }]}>
              {line}
            </Text>
          ))}
          {hasControls ? (
            <View style={styles.actions}>
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
                <Button
                  label={t('common.close', { defaultValue: 'Close' })}
                  onPress={onDismiss}
                  variant="secondary"
                  size="sm"
                  testID={`${testID}-dismiss`}
                />
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.bodyCompact,
    fontWeight: '600',
    flexShrink: 1,
  },
  detail: {
    ...typography.caption,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
