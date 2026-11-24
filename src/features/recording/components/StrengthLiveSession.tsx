import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useAthlete, useTheme } from '@/shared/app';
import { useRecordingKeepAwake } from '@/features/recording/hooks/useRecordingKeepAwake';
import type { LiveStrengthSessionHandle } from '@/features/recording/hooks/useLiveStrengthSession';
import { useStrengthFocus } from '@/features/recording/hooks/useStrengthFocus';
import { useStrengthHeartRate } from '@/features/recording/hooks/useStrengthHeartRate';
import { dropPoint, resolveDrop, type CardBox } from '@/features/recording/lib/strengthDrop';
import { ExercisePicker } from '@/features/strength';
import { Button } from '@/shared/ui/Button';
import { useBottomClearance } from '@/shared/ui/tabBarClearance';
import { confirmAction } from '@/shared/ui/dialog';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

import { StrengthExerciseCard, StrengthRestControl } from './StrengthExerciseCard';
import { StrengthFocusView } from './StrengthFocusView';

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** How long the rest in progress has run, ticking once a second. */
function RestBanner({ startedAt, onSkip }: { startedAt: number; onSkip: () => void }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={[styles.banner, { backgroundColor: palette.fillNeutral }]}>
      <Text
        testID="strength-rest-elapsed"
        style={[styles.bannerText, { color: palette.textPrimary }]}
      >
        {t('strength.recorder.resting', { time: clock(now - startedAt) })}
      </Text>
      <Button
        testID="strength-rest-skip"
        size="sm"
        variant="secondary"
        label={t('strength.recorder.skipRest')}
        onPress={onSkip}
      />
    </View>
  );
}

interface StrengthLiveSessionProps {
  live: LiveStrengthSessionHandle;
  /** The athlete is done: open the review. */
  onFinish: () => void;
}

/**
 * The session being recorded: exercises with their set rows, the picker to add one, a rest per
 * exercise or group and the finish. It holds none of the session. Each control sends one edit
 * through `live` and the screen draws the session the engine answers with.
 */
export function StrengthLiveSession({ live, onFinish }: StrengthLiveSessionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const bottomClearance = useBottomClearance();
  const { data: athlete } = useAthlete();
  const { session, focus, prefilledDaysAgo, refused, edit, discard } = live;
  const [picking, setPicking] = useState(false);
  const [focusing, setFocusing] = useState(false);
  const { names, nowMs } = useStrengthFocus(session, focus);
  useStrengthHeartRate(session);
  const boxes = useRef<(CardBox | undefined)[]>([]);
  // The list's scroll, read as it moves, and as it stood when a handle was taken up.
  const scrollY = useRef(0);
  const dragStartScrollY = useRef(0);
  useRecordingKeepAwake();

  const send = useCallback(
    (change: Parameters<typeof edit>[0]) => {
      edit(change);
    },
    [edit]
  );

  const toggleDone = useCallback(
    (exercise: number, set: number) => {
      const row = session?.exercises[exercise]?.sets[set];
      if (!row) return;
      if (row.done) {
        edit({ kind: 'ReopenSet', exercise, set });
        return;
      }
      const after = edit({ kind: 'CompleteSet', exercise, set });
      // A rest follows the set unless that was the last one to do.
      if (after && after.currentExercise != null) edit({ kind: 'StartRest' });
    },
    [session, edit]
  );

  // Moving on ends the rest if one runs, and otherwise finishes the set in hand.
  const advance = useCallback(() => {
    if (focus?.restStartedAt != null) {
      edit({ kind: 'EndRest' });
      return;
    }
    const exercise = session?.currentExercise;
    const set = session?.currentSet;
    if (exercise != null && set != null) toggleDone(exercise, set);
  }, [focus, session, edit, toggleDone]);

  // The list's own scroll claims a vertical touch and cancels the handle's pan, so it is held still
  // from touch down on a handle until the touch ends.
  const [dragging, setDragging] = useState(false);
  const dragStart = useCallback(() => {
    dragStartScrollY.current = scrollY.current;
    setDragging(true);
  }, []);
  const dragEnd = useCallback(() => setDragging(false), []);

  const drop = useCallback(
    (index: number, translationY: number) => {
      const box = boxes.current[index];
      if (!box) return;
      const scrolledBy = scrollY.current - dragStartScrollY.current;
      const change = resolveDrop(boxes.current, index, dropPoint(box, translationY, scrolledBy));
      if (change) edit(change);
    },
    [edit]
  );

  const measure = (index: number) => (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    boxes.current[index] = { top: y, height };
  };

  const askDiscard = () =>
    confirmAction({
      title: t('strength.recorder.discardTitle'),
      message: t('strength.recorder.discardMessage'),
      confirmLabel: t('strength.recorder.discard'),
      cancelLabel: t('strength.recorder.cancel'),
      destructive: true,
      onConfirm: discard,
    });

  if (!session) return null;

  if (picking) {
    return (
      <View style={[styles.fill, { backgroundColor: palette.surfacePage }]}>
        <ExercisePicker
          gender={athlete?.sex === 'F' ? 'female' : 'male'}
          after={null}
          onPick={(row) => {
            setPicking(false);
            edit({ kind: 'AddExercise', category: row.category, name: row.name });
          }}
        />
        <View style={[styles.bar, { paddingBottom: bottomClearance }]}>
          <Button
            testID="strength-picker-cancel"
            variant="secondary"
            label={t('strength.recorder.cancel')}
            onPress={() => setPicking(false)}
          />
        </View>
      </View>
    );
  }

  if (focusing && focus) {
    return (
      <StrengthFocusView
        focus={focus}
        names={names}
        nowMs={nowMs}
        onAdvance={advance}
        onClose={() => setFocusing(false)}
      />
    );
  }

  const exercises = session.exercises;
  return (
    <View style={[styles.fill, { backgroundColor: palette.surfacePage }]} testID="strength-session">
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        scrollEnabled={!dragging}
      >
        {session.restStartedAt != null ? (
          <RestBanner startedAt={session.restStartedAt} onSkip={() => send({ kind: 'EndRest' })} />
        ) : null}
        {refused ? (
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {t('strength.recorder.refused')}
          </Text>
        ) : null}
        {prefilledDaysAgo != null ? (
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {t('strength.recorder.prefilled', { count: prefilledDaysAgo })}
          </Text>
        ) : null}

        {exercises.map((exercise, index) => {
          const startsGroup =
            exercise.groupNo != null && exercises[index - 1]?.groupNo !== exercise.groupNo;
          const groupRest = session.groups.find((g) => g.groupNo === exercise.groupNo)?.restSecs;
          return (
            // The list is the session's order; an exercise has no id of its own.
            <View key={index} onLayout={measure(index)} style={styles.item}>
              {startsGroup && exercise.groupNo != null ? (
                <View style={styles.groupHeader}>
                  <Text style={[styles.groupLabel, { color: palette.textSecondary }]}>
                    {t('strength.recorder.groupLabel', { n: exercise.groupNo })}
                  </Text>
                  <StrengthRestControl
                    testID={`strength-group-${exercise.groupNo}-rest`}
                    label={t('strength.recorder.restGroup')}
                    secs={groupRest}
                    onChange={(secs) =>
                      send({
                        kind: 'GroupRest',
                        groupNo: exercise.groupNo as number,
                        ...(secs == null ? {} : { value: secs }),
                      })
                    }
                  />
                </View>
              ) : null}
              <StrengthExerciseCard
                index={index}
                exercise={exercise}
                weightUnit={session.weightUnit}
                currentSet={session.currentExercise === index ? session.currentSet : undefined}
                hasPrevious={index > 0}
                hasNext={index < exercises.length - 1}
                edit={send}
                toggleDone={(set) => toggleDone(index, set)}
                onDragStart={dragStart}
                onDragEnd={dragEnd}
                onDrop={(translationY) => drop(index, translationY)}
              />
            </View>
          );
        })}

        <Button
          testID="strength-add-exercise"
          variant="secondary"
          icon="plus"
          label={t('strength.recorder.addExercise')}
          onPress={() => setPicking(true)}
        />
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: bottomClearance }]}>
        <Button
          testID="strength-discard"
          variant="ghost"
          label={t('strength.recorder.discard')}
          onPress={askDiscard}
        />
        <Button
          testID="strength-focus-open"
          variant="secondary"
          label={t('strength.focus.open')}
          onPress={() => setFocusing(true)}
        />
        <Button testID="strength-finish" label={t('strength.recorder.finish')} onPress={onFinish} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  item: { gap: spacing.xs },
  groupHeader: { gap: spacing.xs },
  groupLabel: { ...typography.caption },
  note: { ...typography.caption },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: layout.borderRadiusMd,
  },
  bannerText: { ...typography.bodyCompactBold },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
