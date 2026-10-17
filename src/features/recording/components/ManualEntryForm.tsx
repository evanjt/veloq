import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { View, Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/Button';
import { ScreenScrollView } from '@/shared/ui/ScreenScrollView';
import { TextField } from '@/shared/ui/TextField';
import { navigateTo } from '@/shared/app/navigation';
import { useDiscardGuard } from '@/shared/app/useDiscardGuard';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { parseDecimalInput } from '@/shared/format/decimalInput';
import { longDistanceToMeters, longDistanceUnitLabel } from '@/shared/format/format';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { ActivityType } from '@/types';
import { styles } from '../RecordingScreen.styles';

function TouchableButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.buttonContainer}>
      <Button
        {...(testID && { testID })}
        label={label}
        onPress={onPress}
        disabled={disabled === true}
      />
    </View>
  );
}

export interface ManualPrefill {
  name?: string;
  durationMinutes?: string;
  notes?: string;
}

export function ManualEntryForm({
  activityType,
  pairedEventId,
  bottomPadding,
  prefill,
  rpe,
  above,
  unsaved = false,
}: {
  activityType: ActivityType;
  pairedEventId?: number | undefined;
  bottomPadding: number;
  prefill?: ManualPrefill | undefined;
  rpe?: number | null | undefined;
  above?: ReactNode;
  /** The form opens on input nothing has saved yet, such as a finished guided session. */
  unsaved?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const distanceLabel = t('recording.distance', {
    unit: longDistanceUnitLabel(isMetric),
    defaultValue: 'Distance ({{unit}})',
  });

  const [name, setName] = useState(prefill?.name ?? '');
  const [durationMinutes, setDurationMinutes] = useState(prefill?.durationMinutes ?? '');
  const [distance, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [notes, setNotes] = useState(prefill?.notes ?? '');
  const [durationError, setDurationError] = useState(false);
  const [distanceError, setDistanceError] = useState(false);
  const [hrError, setHrError] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const stopWaiting = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWaiting.current?.(), []);
  useDiscardGuard(
    unsaved ||
      name !== (prefill?.name ?? '') ||
      durationMinutes !== (prefill?.durationMinutes ?? '') ||
      distance !== '' ||
      avgHr !== '' ||
      notes !== (prefill?.notes ?? '')
  );

  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    if (stopWaiting.current) return;
    const session = useRecordingStore.getState();
    const owner = useAuthStore.getState().athleteId;
    // Another athlete's ride still sits in the store while its backup is handed
    // off after sign-in. It is not this athlete's to review or replace.
    const handingOff =
      session.status !== 'idle' && !!session.athleteId && session.athleteId !== owner;
    if (!handingOff) {
      if (session.status === 'stopped') {
        navigateTo('/recording/review');
        return;
      }
      if (session.status !== 'idle') return;
    }

    let hasError = false;

    const mins = parseDecimalInput(durationMinutes);
    if (mins == null || mins <= 0) {
      setDurationError(true);
      hasError = true;
    } else {
      setDurationError(false);
    }

    // The cap is in the unit the athlete typed.
    const dist = distance ? parseDecimalInput(distance) : null;
    if (distance) {
      if (dist == null || dist < 0 || dist > 999) {
        setDistanceError(true);
        hasError = true;
      } else {
        setDistanceError(false);
      }
    } else {
      setDistanceError(false);
    }

    const hr = avgHr ? parseDecimalInput(avgHr) : null;
    if (avgHr) {
      if (hr == null || hr < 30 || hr > 250) {
        setHrError(true);
        hasError = true;
      } else {
        setHrError(false);
      }
    } else {
      setHrError(false);
    }

    if (hasError || mins == null) return;

    setIsNavigating(true);

    const openReview = () => {
      useRecordingStore.getState().startRecording(activityType, 'manual', pairedEventId);

      // Navigate to review with manual params
      navigateTo({
        pathname: '/recording/review',
        params: {
          manual: 'true',
          name: name || undefined,
          durationSeconds: String(Math.round(mins * 60)),
          distance:
            dist != null ? String(Math.round(longDistanceToMeters(dist, isMetric))) : undefined,
          avgHr: hr != null ? String(hr) : undefined,
          notes: notes || undefined,
          rpe: rpe != null ? String(rpe) : undefined,
        },
      });
    };
    if (!handingOff) {
      openReview();
      return;
    }

    // The entry waits for the handoff to clear the store, and opens only for
    // the athlete who made it. The handoff can restore that athlete's own held
    // ride in the same step as it clears the store, so the entry looks again
    // once that step is over, and a stopped ride of theirs keeps its review.
    let cancelled = false;
    const unsubscribe = useRecordingStore.subscribe((state) => {
      if (state.status !== 'idle') return;
      unsubscribe();
      void Promise.resolve().then(() => {
        if (cancelled) return;
        stopWaiting.current = null;
        const auth = useAuthStore.getState();
        const current = useRecordingStore.getState();
        const signedIn = auth.isAuthenticated && !!owner && auth.athleteId === owner;
        if (signedIn && current.status === 'idle') {
          openReview();
        } else if (signedIn && current.status === 'stopped' && current.athleteId === owner) {
          navigateTo('/recording/review');
        } else {
          setIsNavigating(false);
        }
      });
    });
    stopWaiting.current = () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activityType, pairedEventId, name, durationMinutes, distance, avgHr, notes, rpe, isMetric]);

  return (
    // The caller pads the bottom edge itself, so the system adds no inset of its own.
    <ScreenScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.manualForm, { paddingBottom: bottomPadding }]}
    >
      {above}
      <TextField
        testID="manual-entry-name"
        label={t('recording.activityName', 'Activity name')}
        style={styles.field}
        value={name}
        onChangeText={setName}
        placeholder={t(`activityTypes.${activityType}`, activityType)}
      />
      <TextField
        testID="manual-entry-duration"
        label={t('recording.duration', 'Duration (minutes)')}
        required
        error={
          durationError ? t('recording.durationRequired', 'Please enter a valid duration.') : null
        }
        style={styles.field}
        value={durationMinutes}
        onChangeText={(v) => {
          setDurationMinutes(v);
          if (durationError) setDurationError(false);
        }}
        placeholder="60"
        keyboardType="decimal-pad"
      />
      <TextField
        testID="manual-entry-distance"
        label={distanceLabel}
        error={
          distanceError
            ? t('recording.distanceInvalid', 'Please enter a valid distance (0-999).')
            : null
        }
        style={styles.field}
        value={distance}
        onChangeText={(v) => {
          setDistance(v);
          if (distanceError) setDistanceError(false);
        }}
        placeholder="0"
        keyboardType="decimal-pad"
      />
      <TextField
        testID="manual-entry-hr"
        label={t('recording.avgHr', 'Average heart rate (bpm)')}
        error={
          hrError ? t('recording.hrInvalid', 'Please enter a valid heart rate (30-250).') : null
        }
        style={styles.field}
        value={avgHr}
        onChangeText={(v) => {
          setAvgHr(v);
          if (hrError) setHrError(false);
        }}
        placeholder="0"
        keyboardType="number-pad"
      />
      <TextField
        testID="manual-entry-notes"
        label={t('recording.notes', 'Notes')}
        style={styles.field}
        value={notes}
        onChangeText={setNotes}
        placeholder={t('recording.notesPlaceholder', 'How did it feel?')}
        multiline
        numberOfLines={4}
      />

      <TouchableButton
        testID="manual-entry-continue"
        label={t('recording.continue', 'Continue')}
        onPress={handleSave}
        disabled={isNavigating}
      />
    </ScreenScrollView>
  );
}
