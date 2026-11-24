import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { strength, type FfiLiveStrengthSession } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { returnTo } from '@/shared/app/navigation';
import { useDiscardGuard } from '@/shared/app/useDiscardGuard';
import { engineErrorKey } from '@/shared/native/engineError';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { queryKeys } from '@/shared/query/queryKeys';
import { Button } from '@/shared/ui/Button';
import * as haptics from '@/shared/ui/haptics';
import { NOTICE_LONG_MS, showNotice } from '@/shared/ui/Notice';
import { ScreenScrollView } from '@/shared/ui/ScreenScrollView';
import { TextField } from '@/shared/ui/TextField';
import { finishStrengthSession, savedNoticeKey } from '@/features/recording/lib/strengthFinish';
import { colors, darkColors, spacing } from '@/theme';
import type { ActivityType } from '@/types';

import { ManualEntry } from './ManualEntry';
import { RpeSlider } from './RpeSlider';
import { styles } from '../RecordingScreen.styles';

/**
 * The review of a finished session: its name and effort. Saving finishes the session through the
 * engine, which writes the FIT of the sets done and queues it for upload. A session with no set
 * done has no file to write, so it falls back to the manual form, prefilled with its length.
 */
export function StrengthReview({
  session,
  finishedAt,
  activityType,
  pairedEventId,
}: {
  session: FfiLiveStrengthSession;
  /** When the athlete finished, in epoch seconds. */
  finishedAt: number;
  activityType: ActivityType;
  pairedEventId: number | undefined;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const queryClient = useQueryClient();
  const themeColors = isDark ? darkColors : colors;
  const [name, setName] = useState(() => t('strength.recorder.reviewName'));
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [noSets, setNoSets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);
  // The session is a draft until the review saves it, so the engine keeps it while the review is
  // open and drops it once the review is left unsaved. A finished session is no longer live.
  useDiscardGuard(!saved);
  useEffect(
    () => () => {
      if (!settled.current) strength.discardLiveStrengthSession();
    },
    []
  );

  const handleSave = useCallback(async () => {
    const athleteId = useAuthStore.getState().athleteId;
    if (!athleteId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await finishStrengthSession({ name, rpe, athleteId });
      if (outcome.kind === 'noSets') {
        strength.discardLiveStrengthSession();
        settled.current = true;
        setNoSets(true);
        setSaving(false);
        return;
      }
      settled.current = true;
      setSaved(true);
      haptics.success();
      const noticeKey = savedNoticeKey(outcome);
      if (noticeKey === null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
        requestSyncRefresh();
      } else {
        showNotice({ message: t(noticeKey), duration: NOTICE_LONG_MS });
      }
      returnTo('/');
    } catch (err) {
      setError(t(engineErrorKey(err, 'recording.saveError')));
      setSaving(false);
    }
  }, [name, rpe, saving, queryClient, t]);

  const prefill = useMemo(() => {
    const startedAt = session.startedAt ?? finishedAt;
    return {
      name,
      durationMinutes: String(Math.max(1, Math.round((finishedAt - startedAt) / 60))),
      notes: session.exercises
        .map((exercise) => {
          const done = exercise.sets.filter((set) => set.done).length;
          return done > 0 ? `${exercise.displayName} × ${done}` : null;
        })
        .filter((line) => line != null)
        .join('\n'),
    };
  }, [session, finishedAt, name]);

  if (noSets) {
    return (
      <ManualEntry
        activityType={activityType}
        pairedEventId={pairedEventId}
        prefill={prefill}
        rpe={rpe}
        unsaved
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.surfacePage }]}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.manualForm, { paddingBottom: spacing.md }]}
      >
        <RpeSlider
          value={rpe ?? 5}
          onValueChange={setRpe}
          textSecondary={themeColors.textSecondary}
        />
        <TextField
          testID="strength-review-name"
          label={t('recording.activityName', 'Activity name')}
          style={styles.field}
          value={name}
          onChangeText={setName}
          error={error}
        />
        <View style={styles.buttonContainer}>
          <Button
            testID="strength-review-save"
            label={t('strength.recorder.finish')}
            onPress={() => void handleSave()}
            disabled={saving}
          />
        </View>
      </ScreenScrollView>
    </View>
  );
}
