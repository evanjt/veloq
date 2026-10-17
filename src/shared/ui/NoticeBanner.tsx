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
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useBannerTopPadding } from '@/shared/app/TopSafeAreaContext';
import { useTopBannerHeights, type ShownBanner } from '@/shared/app/topBanner';
import { controlHeight, iconSize, motionPresets, spacing, stroke, typography } from '@/theme';
import { Icon } from './Icon';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';
import { useLargeText } from './useLargeText';
import { noticePalette, type NoticeTone } from './noticePalette';

export { noticePalette, type NoticePalette, type NoticeTone } from './noticePalette';

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
          <View style={[styles.headline, !stacked && styles.headlineBeside]}>
            <Icon name={icon} size={iconSize.sm} color={ground.icon} />
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
                  <Icon name="close" size={iconSize.sm} color={ground.subtext} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Beside the controls the text takes the width they leave. Stacked, the
  // column's height is its content, so a flex child would grow from nothing
  // into no spare height and draw at zero.
  headlineBeside: {
    flex: 1,
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
