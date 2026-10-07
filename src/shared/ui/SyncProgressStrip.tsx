/**
 * The one place a running sync reports its step.
 *
 * It floats over the page just above the tab bar, so showing or hiding it
 * moves nothing underneath. The mark turns slowly, the text line has a fixed
 * height and the steps cross-fade inside it, so a new message never changes
 * the strip's size or position.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { SyncState } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { formatSyncProgressParts } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { colorWithOpacity, colors, darkColors, spacing, typography } from '@/theme';

const MARK_SIZE = typography.bodyCompact.lineHeight;
const TURN_MS = 2400;
const FADE_IN_MS = 400;
const FADE_OUT_MS = 250;

/** One text line, so it fits the fade zone above the tab bar's icons. */
export const SYNC_STRIP_HEIGHT = typography.bodyCompact.lineHeight;

function SyncMark({ color }: { color: string }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(turn);
      turn.value = 0;
      return undefined;
    }
    turn.value = withRepeat(withTiming(1, { duration: TURN_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));

  return (
    <Animated.View
      testID="sync-progress-mark"
      style={[
        styles.mark,
        { borderTopColor: color, borderColor: colorWithOpacity(color, 0.3) },
        style,
      ]}
    />
  );
}

export function SyncProgressStrip() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();

  const syncing = status?.state === SyncState.Syncing;
  useAnnounceOnAppear(syncing ? (t('settings.syncActivities') as string) : null);

  if (!syncing) return null;

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const { label, counts } = formatSyncProgressParts(status, t);

  return (
    <View
      testID="sync-progress-strip"
      style={styles.strip}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <SyncMark color={textSecondary} />
      <View testID="sync-progress-line" style={styles.line}>
        <Animated.Text
          key={label}
          entering={FadeIn.duration(FADE_IN_MS)}
          exiting={FadeOut.duration(FADE_OUT_MS)}
          style={[styles.text, { color: textSecondary }]}
          numberOfLines={1}
          testID="sync-progress-message"
        >
          {label}
        </Animated.Text>
      </View>
      {counts !== null && (
        <Animated.Text
          style={[styles.text, styles.counts, { color: textSecondary }]}
          numberOfLines={1}
          testID="sync-progress-counts"
        >
          {counts}
        </Animated.Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SYNC_STRIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  mark: {
    width: MARK_SIZE / 1.5,
    height: MARK_SIZE / 1.5,
    borderRadius: MARK_SIZE,
    borderWidth: spacing.xxs,
  },
  line: {
    flexShrink: 1,
    height: typography.bodyCompact.lineHeight,
    justifyContent: 'center',
    // Wide enough for the longest step line, so the mark and counts keep still.
    minWidth: '55%',
  },
  text: {
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: typography.bodyCompact.lineHeight,
  },
  counts: {
    fontVariant: ['tabular-nums'],
    minWidth: spacing.xxl + spacing.lg,
    textAlign: 'right',
  },
});
