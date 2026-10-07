import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { View, TextInput, ScrollView, TouchableOpacity, Keyboard } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, typography, spacing } from '@/theme';
import { navigateTo } from '@/shared/app/navigation';
import { useAuthStore } from '@/shared/app/AuthStore';
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
      <TouchableOpacity
        testID={testID}
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.primaryButton,
          { backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 },
        ]}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryButtonText}>{label}</Text>
      </TouchableOpacity>
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
}: {
  activityType: ActivityType;
  pairedEventId?: number | undefined;
  bottomPadding: number;
  prefill?: ManualPrefill | undefined;
  rpe?: number | null | undefined;
  above?: ReactNode;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

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

  const themeColors = isDark ? darkColors : colors;
  const textPrimary = themeColors.textPrimary;
  const textSecondary = themeColors.textSecondary;
  const surface = themeColors.surface;
  const border = themeColors.border;
  // The border takes the fill, the validation line under it is text.
  const errorColor = themeColors.error;
  const errorTextColor = isDark ? darkColors.errorDeep : colors.errorDeep;

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

    const mins = parseFloat(durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setDurationError(true);
      hasError = true;
    } else {
      setDurationError(false);
    }

    if (distance) {
      const dist = parseFloat(distance);
      if (!Number.isFinite(dist) || dist < 0 || dist > 999) {
        setDistanceError(true);
        hasError = true;
      } else {
        setDistanceError(false);
      }
    } else {
      setDistanceError(false);
    }

    if (avgHr) {
      const hr = parseFloat(avgHr);
      if (!Number.isFinite(hr) || hr < 30 || hr > 250) {
        setHrError(true);
        hasError = true;
      } else {
        setHrError(false);
      }
    } else {
      setHrError(false);
    }

    if (hasError) return;

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
          distance: distance ? String(parseFloat(distance) * 1000) : undefined, // km to m
          avgHr: avgHr || undefined,
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
  }, [activityType, pairedEventId, name, durationMinutes, distance, avgHr, notes, rpe]);

  return (
    <ScrollView contentContainerStyle={[styles.manualForm, { paddingBottom: bottomPadding }]}>
      {above}
      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        {t('recording.activityName', 'Activity Name')}
      </Text>
      <TextInput
        testID="manual-entry-name"
        accessibilityLabel={t('recording.activityName', 'Activity Name')}
        style={[
          styles.input,
          { color: textPrimary, backgroundColor: surface, borderColor: border },
        ]}
        value={name}
        onChangeText={setName}
        placeholder={t(`activityTypes.${activityType}`, activityType)}
        placeholderTextColor={textSecondary}
      />

      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        {t('recording.duration', 'Duration (minutes)')} *
      </Text>
      <TextInput
        testID="manual-entry-duration"
        accessibilityLabel={t('recording.duration', 'Duration (minutes)')}
        style={[
          styles.input,
          {
            color: textPrimary,
            backgroundColor: surface,
            borderColor: durationError ? errorColor : border,
          },
        ]}
        value={durationMinutes}
        onChangeText={(v) => {
          setDurationMinutes(v);
          if (durationError) setDurationError(false);
        }}
        placeholder="60"
        placeholderTextColor={textSecondary}
        keyboardType="numeric"
      />
      {durationError && (
        <Text
          style={{
            color: errorTextColor,
            fontSize: typography.caption.fontSize,
            marginTop: spacing.xxs,
          }}
        >
          {t('recording.durationRequired', 'Please enter a valid duration.')}
        </Text>
      )}

      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        {t('recording.distance', 'Distance (km)')}
      </Text>
      <TextInput
        testID="manual-entry-distance"
        accessibilityLabel={t('recording.distance', 'Distance (km)')}
        style={[
          styles.input,
          {
            color: textPrimary,
            backgroundColor: surface,
            borderColor: distanceError ? errorColor : border,
          },
        ]}
        value={distance}
        onChangeText={(v) => {
          setDistance(v);
          if (distanceError) setDistanceError(false);
        }}
        placeholder="0"
        placeholderTextColor={textSecondary}
        keyboardType="numeric"
      />
      {distanceError && (
        <Text
          style={{
            color: errorTextColor,
            fontSize: typography.caption.fontSize,
            marginTop: spacing.xxs,
          }}
        >
          {t('recording.distanceInvalid', 'Please enter a valid distance (0-999).')}
        </Text>
      )}

      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        {t('recording.avgHr', 'Average Heart Rate (bpm)')}
      </Text>
      <TextInput
        testID="manual-entry-hr"
        accessibilityLabel={t('recording.avgHr', 'Average Heart Rate (bpm)')}
        style={[
          styles.input,
          {
            color: textPrimary,
            backgroundColor: surface,
            borderColor: hrError ? errorColor : border,
          },
        ]}
        value={avgHr}
        onChangeText={(v) => {
          setAvgHr(v);
          if (hrError) setHrError(false);
        }}
        placeholder="0"
        placeholderTextColor={textSecondary}
        keyboardType="numeric"
      />
      {hrError && (
        <Text
          style={{
            color: errorTextColor,
            fontSize: typography.caption.fontSize,
            marginTop: spacing.xxs,
          }}
        >
          {t('recording.hrInvalid', 'Please enter a valid heart rate (30-250).')}
        </Text>
      )}

      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        {t('recording.notes', 'Notes')}
      </Text>
      <TextInput
        testID="manual-entry-notes"
        accessibilityLabel={t('recording.notes', 'Notes')}
        style={[
          styles.input,
          styles.notesInput,
          { color: textPrimary, backgroundColor: surface, borderColor: border },
        ]}
        value={notes}
        onChangeText={setNotes}
        placeholder={t('recording.notesPlaceholder', 'How did it feel?')}
        placeholderTextColor={textSecondary}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <TouchableButton
        testID="manual-entry-continue"
        label={t('recording.continue', 'Continue')}
        onPress={handleSave}
        disabled={isNavigating}
      />
    </ScrollView>
  );
}
