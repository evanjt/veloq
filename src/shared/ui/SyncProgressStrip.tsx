/**
 * The one place a running sync reports its step.
 *
 * A slim pill in the app colour, centred just under the top safe-area inset so
 * it clears the camera cutout and the status bar, or under the banners in the
 * top slot when there are any, so it never covers a sync failure's headline. It floats over the page and
 * passes touches through, so showing or hiding it moves nothing underneath. The
 * mark turns slowly, the line holds one row with the label giving way before
 * the counts, and each step stays on screen for a minimum time and cross-fades
 * into the next, so a burst of quick steps reads as a few calm changes.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { SyncState } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { useFloatingPillTop } from '@/shared/app/TopSafeAreaContext';
import { useReduceMotion } from './reduceMotion';
import { formatSyncProgressParts } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { colorWithOpacity, colors, darkColors, layout, spacing, typography } from '@/theme';

const MARK_SIZE = typography.bodyCompact.lineHeight;
const TURN_MS = 2400;
const FADE_IN_MS = 700;
const FADE_OUT_MS = 500;

/** The least time one step's line stays on screen before the next replaces it. */
export const SYNC_MESSAGE_HOLD_MS = 1500;

interface SyncLine {
  label: string;
  counts: string | null;
}

/**
 * The line to draw, held for `SYNC_MESSAGE_HOLD_MS` before a new step, or the
 * end of the sync, replaces it. Steps that arrive inside the hold are skipped
 * for the latest one. A new count inside the same step follows at once, since
 * it moves the same line on rather than replacing it.
 */
function useHeldLine(latest: SyncLine | null): SyncLine | null {
  const [shown, setShown] = useState<SyncLine | null>(null);
  // Whether the shown step has had its time, so the next one may replace it.
  const [free, setFree] = useState(true);

  const label = latest?.label ?? null;
  const shownLabel = shown?.label ?? null;

  if (label !== shownLabel && (free || shownLabel === null)) {
    setShown(latest);
    setFree(latest === null);
  }

  useEffect(() => {
    if (free) return undefined;
    const timer = setTimeout(() => setFree(true), SYNC_MESSAGE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [shownLabel, free]);

  return label === shownLabel ? latest : shown;
}

function SyncMark({ color }: { color: string }) {
  const reduceMotion = useReduceMotion();
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
  const top = useFloatingPillTop();
  const status = useSyncStatus();

  const syncing = status?.state === SyncState.Syncing;
  const line = useHeldLine(syncing ? formatSyncProgressParts(status, t) : null);
  useAnnounceOnAppear(line ? (t('settings.syncActivities') as string) : null);

  if (!line) return null;

  const fill = (isDark ? darkColors : colors).appColourPillBackground;
  const ink = colors.textOnDark;
  const { label, counts } = line;

  return (
    <View
      testID="sync-progress-strip"
      style={[styles.strip, { top }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <View testID="sync-progress-pill" style={[styles.pill, { backgroundColor: fill }]}>
        <SyncMark color={ink} />
        <View testID="sync-progress-line" style={styles.line}>
          <Animated.Text
            key={label}
            entering={FadeIn.duration(FADE_IN_MS)}
            exiting={FadeOut.duration(FADE_OUT_MS)}
            style={[styles.text, { color: ink }]}
            numberOfLines={1}
            ellipsizeMode="tail"
            testID="sync-progress-message"
          >
            {label}
          </Animated.Text>
        </View>
        {counts !== null && (
          <Animated.Text
            style={[styles.text, styles.counts, { color: ink }]}
            numberOfLines={1}
            testID="sync-progress-counts"
          >
            {counts}
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 1000,
    alignItems: 'center',
  },
  pill: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusFull,
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
  },
  text: {
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: typography.bodyCompact.lineHeight,
  },
  counts: {
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
});
