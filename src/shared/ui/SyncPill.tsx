/**
 * The one place a running sync reports its step, as a status pill in the
 * floating stack, so it shows on every route.
 *
 * A routine check stays quiet. The pill shows once a sync has run past the
 * grace period or a step reports how many items it is fetching. Once the
 * metadata sync has settled, the GPS download the engine carries on with shows
 * here too, counted, on the same grace period.
 *
 * It is the status pill like any other, on the raised surface, and its one
 * blue is the ring's turning arc in the on colour over the track. The ring
 * turns slowly, the label wraps while the counts stay whole, and each step
 * stays on screen for a minimum time and cross-fades into the next, so a burst
 * of quick steps reads as a few calm changes. A screen that shows the sync's
 * progress itself, the feed's first-sync view, puts it aside while it is in
 * front, so one indicator counts the steps and not two.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { SyncState, type SyncStatus } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { useReduceMotion } from './reduceMotion';
import { FloatingPill } from './FloatingPill';
import { formatSyncProgressParts } from '@/shared/format/syncProgress';
import { formatTrackProgressParts } from '@/features/maps/lib/syncProgressFormat';
import { useSyncStatus, useTrackStage } from '@/shared/native/useSyncStatus';
import { useSyncPillYielded } from './syncPillYield';
import { SYNC_PILL_GRACE_MS, syncPillVisible } from './syncPillVisible';
import { colors, darkColors, duration, easing, iconSize, stroke } from '@/theme';

/** The least time one step's line stays on screen before the next replaces it. */
export const SYNC_MESSAGE_HOLD_MS = duration.hold;

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

function SyncMark() {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const reduceMotion = useReduceMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(turn);
      turn.value = 0;
      return undefined;
    }
    turn.value = withRepeat(
      withTiming(1, { duration: duration.loop, easing: easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));

  return (
    <Animated.View
      testID="sync-progress-mark"
      style={[
        styles.mark,
        { borderTopColor: palette.controlOn, borderColor: palette.track },
        style,
      ]}
    />
  );
}

/**
 * Whether a stretch of work has run past the grace period. One timer starts
 * with `active` and wakes at the end of the grace period, so a stretch that
 * ends sooner never raises the pill.
 */
function useGraceElapsed(active: boolean): boolean {
  const [graced, setGraced] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setGraced(true), SYNC_PILL_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setGraced(false);
    };
  }, [active]);

  return graced;
}

/** Whether the running sync has earned its pill. */
function useSyncPillShown(status: SyncStatus | null): boolean {
  const syncing = status?.state === SyncState.Syncing;
  const graced = useGraceElapsed(syncing);
  return syncPillVisible(status, graced ? SYNC_PILL_GRACE_MS : 0);
}

export function SyncPill() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const stage = useTrackStage();

  const shown = useSyncPillShown(status);
  // The GPS download carries on after the metadata sync settles, so its line
  // takes the pill then. While a metadata step runs, that step keeps the pill.
  const trackParts = formatTrackProgressParts(stage, t);
  const trackGraced = useGraceElapsed(trackParts !== null);
  const trackLine = trackGraced && status?.state !== SyncState.Syncing ? trackParts : null;
  const line = useHeldLine(shown ? formatSyncProgressParts(status, t) : trackLine);
  const yielded = useSyncPillYielded();

  if (!line || yielded) return null;

  return (
    <FloatingPill
      lead={<SyncMark />}
      title={line.label}
      titleKey={line.label}
      detail={line.counts}
      numericDetail
      announcement={t('settings.syncActivities') as string}
      testID="sync-progress-pill"
    />
  );
}

const styles = StyleSheet.create({
  mark: {
    width: iconSize.xs,
    height: iconSize.xs,
    borderRadius: iconSize.xs,
    borderWidth: stroke.two,
  },
});
