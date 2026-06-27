import { useState, useCallback } from 'react';
import { View, TextInput, ScrollView, TouchableOpacity, Keyboard } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, brand } from '@/theme';
import { navigateTo } from '@/shared/app/navigation';
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
        style={[styles.primaryButton, { backgroundColor: brand.teal, opacity: disabled ? 0.5 : 1 }]}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryButtonText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function ManualEntryForm({
  activityType,
  pairedEventId,
  bottomPadding,
}: {
  activityType: ActivityType;
  pairedEventId?: number;
  bottomPadding: number;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [notes, setNotes] = useState('');
  const [durationError, setDurationError] = useState(false);
  const [distanceError, setDistanceError] = useState(false);
  const [hrError, setHrError] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const themeColors = isDark ? darkColors : colors;
  const textPrimary = themeColors.textPrimary;
  const textSecondary = themeColors.textSecondary;
  const surface = themeColors.surface;
  const border = themeColors.border;
  const errorColor = themeColors.error;

  const handleSave = useCallback(() => {
    Keyboard.dismiss();

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

    // Initialize recording store with manual data then navigate to review
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
      },
    });
  }, [activityType, pairedEventId, name, durationMinutes, distance, avgHr, notes, t]);

  return (
    <ScrollView contentContainerStyle={[styles.manualForm, { paddingBottom: bottomPadding }]}>
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
        <Text style={{ color: errorColor, fontSize: 12, marginTop: 2 }}>
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
        <Text style={{ color: errorColor, fontSize: 12, marginTop: 2 }}>
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
        <Text style={{ color: errorColor, fontSize: 12, marginTop: 2 }}>
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
