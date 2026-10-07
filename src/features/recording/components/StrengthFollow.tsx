import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Button, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { colors, darkColors, typography, spacing } from '@/theme';
import type { ActivityType } from '@/types';
import { useRecordingKeepAwake } from '@/features/recording/hooks/useRecordingKeepAwake';
import { readPlannedWorkout } from '@/features/recording/lib/plannedWorkout';
import {
  advance,
  formatLineDuration,
  planText,
  remainingSeconds,
  startFollow,
  syncFollow,
  type PlanLine,
} from '@/features/recording/lib/planFollow';
import { ManualEntry } from './ManualEntry';
import { ManualEntryHeader } from './ManualEntryHeader';
import { RpeSlider } from './RpeSlider';
import { styles } from '../RecordingScreen.styles';

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Follow({
  activityType,
  pairedEventId,
  eventName,
  lines,
}: {
  activityType: ActivityType;
  pairedEventId: number;
  eventName: string;
  lines: readonly PlanLine[];
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const themeColors = isDark ? darkColors : colors;
  useRecordingKeepAwake();

  // The state holds timestamps rather than a running count, so a screen that
  // was backgrounded catches up to the right line when the clock next ticks.
  const [follow, setFollow] = useState(() => startFollow(lines, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [rpe, setRpe] = useState<number | null>(null);

  useEffect(() => {
    if (follow.finishedAt != null) return undefined;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setFollow((s) => syncFollow(s, at));
    }, 250);
    return () => clearInterval(id);
  }, [follow.finishedAt]);

  const tick = useCallback(() => setFollow((s) => advance(s, Date.now())), []);

  const finishedAt = follow.finishedAt;
  const prefill = useMemo(
    () =>
      finishedAt == null
        ? undefined
        : {
            name: eventName,
            durationMinutes: String(
              Math.max(0.1, Math.round(((finishedAt - follow.startedAt) / 60000) * 100) / 100)
            ),
            notes: planText(lines),
          },
    [finishedAt, follow.startedAt, eventName, lines]
  );

  if (finishedAt != null) {
    return (
      <ManualEntry
        activityType={activityType}
        pairedEventId={pairedEventId}
        prefill={prefill}
        rpe={rpe}
        above={
          <RpeSlider
            value={rpe ?? 5}
            onValueChange={setRpe}
            textSecondary={themeColors.textSecondary}
          />
        }
      />
    );
  }

  const line = follow.lines[follow.index];
  if (!line) return null;
  const left = remainingSeconds(follow, now);
  const isRest = line.kind === 'rest';
  const accent = isRest ? themeColors.textSecondary : themeColors.primary;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: themeColors.background, paddingTop: insets.top },
      ]}
      testID="strength-follow"
    >
      <ManualEntryHeader activityType={activityType} textPrimary={themeColors.textPrimary} />
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Text style={{ ...typography.caption, color: themeColors.textSecondary }}>
          {isRest
            ? t('recording.strengthRest', 'Rest')
            : t('recording.strengthLine', 'Line {{n}} of {{total}}', {
                n: follow.index + 1,
                total: follow.lines.length,
              })}
        </Text>
        <Text
          testID="strength-current-line"
          style={{ ...typography.screenTitle, color: themeColors.textPrimary }}
        >
          {line.text || t('recording.strengthRest', 'Rest')}
        </Text>
        {left != null && (
          <Text testID="strength-countdown" style={{ ...typography.screenTitle, color: accent }}>
            {clock(left)}
          </Text>
        )}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {follow.lines.map((l, i) => (
          <Text
            key={i}
            style={{
              ...typography.body,
              paddingVertical: spacing.xs,
              color: i === follow.index ? themeColors.textPrimary : themeColors.textSecondary,
              opacity: i < follow.index ? 0.5 : 1,
              textDecorationLine: i < follow.index ? 'line-through' : 'none',
            }}
          >
            {l.durationSeconds != null
              ? `${l.text || t('recording.strengthRest', 'Rest')}  ${formatLineDuration(l.durationSeconds)}`
              : l.text}
          </Text>
        ))}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: spacing.md,
          paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING,
          paddingTop: spacing.sm,
        }}
      >
        <Button
          testID="strength-tick"
          label={
            follow.index + 1 >= follow.lines.length
              ? t('recording.strengthFinish', 'Finish')
              : t('recording.strengthDone', 'Done')
          }
          onPress={tick}
        />
      </View>
    </View>
  );
}

/**
 * The session for a planned strength workout. The plan is read once on
 * arrival: the lines the athlete follows must not shift under them when a sync
 * lands mid-set. With no plan to follow the manual form stays.
 */
export function StrengthSession({
  activityType,
  pairedEventId,
}: {
  activityType: ActivityType;
  pairedEventId?: number | undefined;
}) {
  const [plan] = useState(() => (pairedEventId == null ? null : readPlannedWorkout(pairedEventId)));
  if (!plan || pairedEventId == null) {
    return <ManualEntry activityType={activityType} pairedEventId={pairedEventId} />;
  }
  return (
    <Follow
      activityType={activityType}
      pairedEventId={pairedEventId}
      eventName={plan.name}
      lines={plan.lines}
    />
  );
}
