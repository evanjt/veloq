/**
 * The recording screen's single transient status slot. Shows at most one
 * message at a time (lap press > refused foreground service > failing crash
 * backup > GPS warning > sensor issue > km-split toast) with an animated swap, replacing the old stack of independent
 * banners.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { tapTo } from '@/shared/app/navigation';
import { colors, colorWithOpacity, duration, iconSize, layout, spacing, typography } from '@/theme';
import { selectStatusMessage, type StatusSlotInput } from '../lib/statusSlot';
import { InlineNotice, OpenSettingsButton } from '@/shared/ui';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';

// Every message drops in and lifts out alike, so a swap reads as one slot.
const ENTERING = FadeInDown.duration(duration.exit);
const EXITING = FadeOutUp.duration(duration.quick);

interface StatusSlotProps extends StatusSlotInput {
  onDismissGpsWarning: () => void;
}

function StatusSlotInner({
  backgroundTrackingWarning,
  backupWarning,
  gpsWarning,
  gpsWarningOpensSettings,
  sensorIssue,
  splitBanner,
  lapBanner,
  onDismissGpsWarning,
}: StatusSlotProps) {
  const message = selectStatusMessage({
    backgroundTrackingWarning,
    backupWarning,
    gpsWarning,
    gpsWarningOpensSettings,
    sensorIssue,
    splitBanner,
    lapBanner,
  });
  // A rider with the phone mounted or pocketed learns the slot by ear. A fault
  // interrupts, through an assertive live region on Android; a split waits.
  useAnnounceOnAppear(message?.spoken);
  if (!message) return null;

  // Each fault is a warning notice the slot speaks itself, through the live
  // region on its wrapper, so the notice does not announce a second time.
  // No dismiss on the first two: the ride still cannot record off screen after
  // it is read, and a backup failure clears once a write lands. Freeing
  // storage does that, not reading it.
  if (message.kind === 'background' || message.kind === 'backup') {
    return (
      <Animated.View
        key={message.kind}
        entering={ENTERING}
        exiting={EXITING}
        style={styles.slot}
        testID={`status-slot-${message.kind}`}
        accessibilityLiveRegion="assertive"
      >
        <InlineNotice
          tone="warning"
          icon={message.kind === 'backup' ? 'content-save-alert-outline' : 'alert-circle-outline'}
          title={message.text}
          announce={false}
        />
      </Animated.View>
    );
  }

  if (message.kind === 'gps') {
    return (
      <Animated.View
        key="gps"
        entering={ENTERING}
        exiting={EXITING}
        style={styles.slot}
        testID="status-slot-gps"
        accessibilityLiveRegion="assertive"
      >
        <InlineNotice
          tone="warning"
          icon="alert-circle-outline"
          title={message.text}
          action={
            message.opensSettings ? (
              <OpenSettingsButton testID="status-slot-gps-settings" />
            ) : undefined
          }
          onDismiss={onDismissGpsWarning}
          announce={false}
        />
      </Animated.View>
    );
  }

  if (message.kind === 'sensor') {
    return (
      <Animated.View
        key="sensor"
        entering={ENTERING}
        exiting={EXITING}
        style={styles.slot}
        testID="status-slot-sensor"
        accessibilityLiveRegion="assertive"
      >
        <InlineNotice
          tone="warning"
          icon="bluetooth"
          title={message.text}
          onPress={() => tapTo('/sensor-settings')}
          announce={false}
        />
      </Animated.View>
    );
  }

  // A lap and a split are the ride's own marks, drawn alike under the lap flag.
  return (
    <Animated.View
      key={message.kind}
      entering={ENTERING}
      exiting={EXITING}
      style={[styles.row, styles.splitRow]}
      testID={`status-slot-${message.kind}`}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={message.spoken}
    >
      <MaterialCommunityIcons name="flag-variant" size={iconSize.sm} color={colors.textOnDark} />
      <Text style={[styles.text, { color: colors.textOnDark }]}>{message.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
    borderRadius: layout.borderRadiusSm,
  },
  splitRow: {
    backgroundColor: colorWithOpacity(colors.success, 0.85),
  },
  text: {
    ...typography.bodyCompact,
    flex: 1,
  },
});

/**
 * The recording screen re-renders every second while the timer runs, so the
 * parts of it that do not change with the clock are held here.
 */
export const StatusSlot = React.memo(StatusSlotInner);
