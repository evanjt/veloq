import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { FfiFocusPhase, type FfiFocusNeighbour, type FfiFocusState } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui/Button';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import { useBottomClearance } from '@/shared/ui/tabBarClearance';
import { focusSetText, type FocusNames } from '@/features/recording/lib/strengthFocus';
import { colors, darkColors, spacing, typography } from '@/theme';

/** How far a horizontal swipe has to travel to move on. */
const SWIPE_DISTANCE = 80;

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

interface StrengthFocusViewProps {
  /** The engine's focus read. The view keeps none of it. */
  focus: FfiFocusState;
  names: FocusNames;
  /** The clock the rest is read against, ms. The owner re-renders it once a second. */
  nowMs: number;
  /** The set is done, or the rest is over: move on. */
  onAdvance: () => void;
  onClose?: () => void;
}

function Neighbour({
  testID,
  label,
  name,
  neighbour,
}: {
  testID: string;
  label: string;
  name: string;
  neighbour: FfiFocusNeighbour;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const progress = t('strength.focus.progress', {
    done: neighbour.setsDone,
    total: neighbour.setCount,
  });
  return (
    <Text testID={testID} style={[styles.neighbour, { color: palette.textSecondary }]}>
      {`${label}: ${name} · ${progress}`}
    </Text>
  );
}

/**
 * The session read at arm's length: the exercise and set in hand large, the rest counting down
 * where it can be read from a distance, and the exercises either side small. A swipe to the left
 * moves on, as does the button, which is the way for anyone who cannot swipe.
 */
export function StrengthFocusView({
  focus,
  names,
  nowMs,
  onAdvance,
  onClose,
}: StrengthFocusViewProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const bottomClearance = useBottomClearance();
  const advance = useGestureCallback(onAdvance);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .withTestId('strength-focus-swipe')
        .activeOffsetX([-20, 20])
        .onEnd((event) => {
          if (event.translationX < -SWIPE_DISTANCE) runOnJS(advance)();
        }),
    [advance]
  );

  const set = focus.current;
  if (!set || focus.phase === FfiFocusPhase.Finished) return null;

  const translate = (key: string, fallback: string, values?: Record<string, string | number>) =>
    t(key, { defaultValue: fallback, ...values });
  const resting = focus.phase === FfiFocusPhase.Rest;
  const remaining =
    focus.restEndsAt != null
      ? clock(focus.restEndsAt - nowMs / 1000)
      : focus.restStartedAt != null
        ? clock(nowMs / 1000 - focus.restStartedAt)
        : null;

  return (
    <GestureDetector gesture={swipe}>
      <View testID="strength-focus" style={[styles.fill, { backgroundColor: palette.surfacePage }]}>
        {focus.previous && names.previous ? (
          <Neighbour
            testID="strength-focus-previous"
            label={t('strength.focus.previous')}
            name={names.previous}
            neighbour={focus.previous}
          />
        ) : null}

        <View style={styles.center}>
          {resting && remaining != null ? (
            <>
              <Text style={[styles.label, { color: palette.textSecondary }]}>
                {t('strength.focus.rest')}
              </Text>
              <Text
                testID="strength-focus-rest"
                style={[styles.restClock, { color: palette.textPrimary }]}
              >
                {remaining}
              </Text>
              <Text style={[styles.label, { color: palette.textSecondary }]}>
                {t('strength.focus.upNext')}
              </Text>
            </>
          ) : null}
          <Text
            testID="strength-focus-exercise"
            style={[styles.exercise, { color: palette.textPrimary }]}
          >
            {names.current}
          </Text>
          <Text testID="strength-focus-set" style={[styles.set, { color: palette.textPrimary }]}>
            {focusSetText(set, translate)}
          </Text>
        </View>

        {focus.next && names.next ? (
          <Neighbour
            testID="strength-focus-next"
            label={t('strength.focus.next')}
            name={names.next}
            neighbour={focus.next}
          />
        ) : null}

        <View style={[styles.bar, { paddingBottom: bottomClearance }]}>
          {onClose ? (
            <Button
              testID="strength-focus-close"
              variant="ghost"
              label={t('strength.focus.close')}
              onPress={onClose}
            />
          ) : null}
          <Button
            testID="strength-focus-advance"
            label={resting ? t('strength.focus.skipRest') : t('strength.focus.done')}
            onPress={onAdvance}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, padding: spacing.md, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.label },
  restClock: { ...typography.heroNumber },
  exercise: { ...typography.screenTitle, textAlign: 'center' },
  set: { ...typography.headlineNumber, textAlign: 'center' },
  neighbour: { ...typography.bodySmall },
  bar: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});
