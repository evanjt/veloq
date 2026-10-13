import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { replaceTo, tapTo } from '@/shared/app/navigation';
import { useBackIntercept } from '@/shared/app/useBackIntercept';
import { useDiscardGuard } from '@/shared/app/useDiscardGuard';
import { overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { colors, colorWithOpacity, darkColors, spacing, layout, typography } from '@/theme';
import { Button, ScreenScrollView, StatusLine, TextField } from '@/shared/ui';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { getActivityIcon, getActivityInk } from '@/shared/activity/activityUtils';

import {
  useRecordingStore,
  useUploadPermissionStore,
  useReviewSave,
  useActivitySummary,
  discardReviewedRecording,
  resumeStoppedRecording,
  useActivityNameGeneration,
  useReviewDraft,
  useRecordingLiveStore,
  generatedActivityName,
  ReviewMapHero,
  ActivityStatsCard,
  SaveErrorBanner,
  recordingBackAction,
} from '@/features/recording';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { ActivityTypeSheetInput } from '@/app/sheets/activity-type';
import type { ActivityType } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { confirmAction } from '@/shared/ui/dialog';

const MAP_FRACTION = 0.45;

/** The effort a manual entry carries in, or null when it carries none on the 1 to 10 scale. */
function parseRpe(raw: string | undefined): number | null {
  const value = Number(raw);
  return raw && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}

function ignoreBack(): void {}

function ReviewScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const params = useLocalSearchParams<{
    manual?: string;
    name?: string;
    durationSeconds?: string;
    distance?: string;
    avgHr?: string;
    notes?: string;
    rpe?: string;
  }>();

  const isManual = params.manual === 'true';
  const rpe = parseRpe(params.rpe);
  useEffect(() => {
    if (!isManual) return undefined;
    return () => {
      if (useRecordingStore.getState().mode === 'manual') useRecordingStore.getState().reset();
    };
  }, [isManual]);
  const activityType = useRecordingStore((s) => s.activityType);
  const recordingStatus = useRecordingStore((s) => s.status);
  const recordingMode = useRecordingStore((s) => s.mode);
  const recordingAthleteId = useRecordingStore((s) => s.athleteId);
  const signedInAthleteId = useAuthStore((s) => s.athleteId);
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const ownedReview =
    authenticated &&
    !!recordingAthleteId &&
    recordingAthleteId === signedInAthleteId &&
    (isManual
      ? recordingStatus === 'recording' && recordingMode === 'manual'
      : recordingStatus === 'stopped' && !!recordingMode && recordingMode !== 'manual');
  const streams = useRecordingStore((s) => s.streams);
  const laps = useRecordingStore((s) => s.laps);
  const startTime = useRecordingStore((s) => s.startTime);
  const stopTime = useRecordingStore((s) => s.stopTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const pauseIntervals = useRecordingStore((s) => s.pauseIntervals);
  const pairedEventId = useRecordingStore((s) => s.pairedEventId);
  const savedToLibrary = useRecordingStore((s) => s.savedToLibrary);
  // The stop handler's write failed and none has landed since, so an app kill
  // here loses the ride. Saving is the only way to keep it.
  const backupFailing = useRecordingLiveStore((s) => s.backupFailures > 0);
  const unbackedRide =
    !isManual && recordingStatus === 'stopped' && !savedToLibrary && backupFailing;

  const lastPoint = Math.max(0, (streams.latlng?.length ?? 0) - 1);
  const { initial: draft, edit: editDraft } = useReviewDraft(streams.latlng?.length ?? 0);
  const [notes, setNotes] = useState(draft.notes ?? params.notes ?? '');
  const [selectedType, setSelectedType] = useState<ActivityType>(
    draft.reviewedType ?? activityType ?? ('Ride' as ActivityType)
  );
  const { name, setName } = useActivityNameGeneration({
    initialName: draft.name ?? params.name,
    startTime,
    type: selectedType,
  });

  const [trimStart, setTrimStart] = useState(draft.trimStart ?? 0);
  const [trimEnd, setTrimEnd] = useState(draft.trimEnd ?? lastPoint);
  // What the map draws. It follows the released handle, not the finger.
  const [mapTrim, setMapTrim] = useState<[number, number]>([
    draft.trimStart ?? 0,
    draft.trimEnd ?? lastPoint,
  ]);

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      editDraft({ name: value });
    },
    [setName, editDraft]
  );

  const handleNotesChange = useCallback(
    (value: string) => {
      setNotes(value);
      editDraft({ notes: value });
    },
    [editDraft]
  );

  // What leaving would keep: the review as it opened, then as a save put it in
  // the library. A GPS ride's edits wait in the store until it is saved, so
  // only a manual entry or a saved ride loses what is on screen.
  const onScreen = { name, notes, type: selectedType, trimStart, trimEnd };
  const [kept, setKept] = useState(onScreen);
  const [keptSaved, setKeptSaved] = useState(savedToLibrary);
  if (savedToLibrary !== keptSaved) {
    setKeptSaved(savedToLibrary);
    if (savedToLibrary) setKept(onScreen);
  }
  const edited =
    (isManual || savedToLibrary) &&
    (name !== kept.name ||
      notes !== kept.notes ||
      selectedType !== kept.type ||
      trimStart !== kept.trimStart ||
      trimEnd !== kept.trimEnd);

  const type = selectedType;
  const canTrim = !isManual && (streams.latlng?.length ?? 0) > 2;
  const hasGps = !isManual && (streams.latlng?.length ?? 0) >= 2;

  const handleTrimChange = useCallback((startIdx: number, endIdx: number) => {
    setTrimStart(startIdx);
    setTrimEnd(endIdx);
  }, []);

  const handleTrimCommit = useCallback(
    (startIdx: number, endIdx: number) => {
      setMapTrim([startIdx, endIdx]);
      editDraft({ trimStart: startIdx, trimEnd: endIdx });
    },
    [editDraft]
  );

  // Summary, trim delta, and trimmed-stream accessor extracted to useActivitySummary
  const { summary, trimDelta, getTrimmedStreams, trimStartIndex, pausedSecondsInWindow } =
    useActivitySummary({
      streams,
      startTime,
      stopTime,
      pausedDuration,
      pauseIntervals,
      trimStart,
      trimEnd,
      canTrim,
      isManual,
      params,
    });

  const ridingWithoutScope = useUploadPermissionStore((s) => s.recordingWithoutScope);

  // Save/upload orchestration extracted to useReviewSave
  const {
    handleSave,
    isUploading,
    errorMessage,
    errorDetail,
    queuedMessage,
    showPermissionFix,
    isOAuthLoading,
    handleUpgradeToOAuth,
    canRetry,
    keptRecording,
    shareKeptRecording,
    lowStorage,
  } = useReviewSave({
    isManual,
    type,
    name,
    summary,
    notes,
    rpe,
    startTime,
    pausedSecondsInWindow,
    laps,
    pairedEventId,
    getTrimmedStreams,
    trimStartIndex,
    canTrim,
  });
  useEffect(() => {
    const foreignSession = !!recordingAthleteId && recordingAthleteId !== signedInAthleteId;
    if (!ownedReview && (foreignSession || (!isUploading && !queuedMessage))) replaceTo('/record');
  }, [ownedReview, recordingAthleteId, signedInAthleteId, isUploading, queuedMessage]);

  // The alert is the guard against a stray tap, as the unlock swipe is for Stop.
  const handleDiscard = useCallback(() => {
    confirmAction({
      title: t('recording.discardConfirmTitle', 'Discard this recording?'),
      message: t(
        'recording.discardConfirmMessage',
        'It has not been saved, and it cannot be recovered once discarded.'
      ),
      confirmLabel: t('recording.discard', 'Discard'),
      cancelLabel: t('common.cancel', 'Cancel'),
      destructive: true,
      onConfirm: () => discardReviewedRecording(startTime),
    });
  }, [t, startTime]);

  const openSheet = useSheetOpener();
  const openTypePicker = useCallback(async () => {
    const result = await openSheet<ActivityTypeSheetInput, ActivityType>('sheets/activity-type', {
      selectedType: type,
      mode: 'review',
    });
    if (result.kind !== 'selected') return;
    setSelectedType(result.value);
    editDraft({ reviewedType: result.value });
  }, [openSheet, type, editDraft]);

  const handleResume = useCallback(() => {
    resumeStoppedRecording().catch(() => {});
  }, []);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const activityColor = getActivityInk(type, isDark);
  const isProcessing = isUploading;
  // The header back hides while a save is in flight, and Android's back control is held with it.
  useBackIntercept(
    recordingBackAction({ status: recordingStatus, isLocked: false, isProcessing }) === 'consume',
    ignoreBack
  );
  // Save and Discard return to the root, which the guard lets through as the app's own navigation.
  useDiscardGuard(ownedReview && edited && !isProcessing && !queuedMessage);
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = hasGps ? windowHeight * MAP_FRACTION : 0;

  if (!ownedReview) return null;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* A GPS recording opens on a map hero that runs under the status bar, so
          its header is the transparent one the detail heroes take, with the
          platform's back floating over the map. Either way the header back is
          the one back, and it goes with the swipe while an upload is in flight. */}
      <Stack.Screen
        options={{
          ...(hasGps && { ...overMapHeaderOptions({ isDark }), headerLargeTitle: false }),
          headerShown: true,
          headerBackVisible: !isProcessing,
          gestureEnabled: !isProcessing,
        }}
      />
      {/* Map hero (top portion) */}
      {hasGps ? (
        <ReviewMapHero
          coordinates={streams.latlng}
          mapHeight={mapHeight}
          topInset={insets.top}
          canTrim={canTrim}
          trimStart={trimStart}
          trimEnd={trimEnd}
          mapTrimStart={mapTrim[0]}
          mapTrimEnd={mapTrim[1]}
          totalDuration={summary.duration}
          totalPoints={streams.latlng.length}
          onTrimChange={handleTrimChange}
          onTrimCommit={handleTrimCommit}
        />
      ) : null}

      {/* Bottom sheet content */}
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        {/* Activity Name */}
        <TextField
          testID="review-activity-name"
          label={t('recording.activityName')}
          value={name}
          onChangeText={handleNameChange}
          placeholder={generatedActivityName(t, type, startTime)}
          editable={!isProcessing}
        />

        {/* Compact stat row */}
        <ActivityStatsCard
          summary={summary}
          activityType={type}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
        />

        {/* Trim delta feedback */}
        {trimDelta ? (
          <Text style={[styles.trimDelta, { color: textSecondary }]}>
            {t('recording.trimmedOff', {
              distance: formatDistance(trimDelta.distance, isMetric),
              time: formatDuration(trimDelta.duration),
            })}
          </Text>
        ) : null}

        {/* Activity Type (tappable) */}
        <Pressable
          accessibilityRole="button"
          testID="review-activity-type"
          style={pressable([styles.typeChip, { backgroundColor: surface, borderColor: border }])}
          android_ripple={pressRipple}
          onPress={() => !isProcessing && openTypePicker()}
        >
          <MaterialCommunityIcons name={getActivityIcon(type)} size={20} color={activityColor} />
          <Text style={[styles.typeText, { color: textPrimary }]}>
            {t(`activityTypes.${type}`, type)}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={textSecondary} />
        </Pressable>

        {/* Notes */}
        <TextField
          testID="review-notes"
          label={t('recording.notes')}
          style={styles.notesField}
          value={notes}
          onChangeText={handleNotesChange}
          placeholder={t('recording.notesPlaceholder', 'How did it feel?')}
          multiline
          numberOfLines={3}
          editable={!isProcessing}
        />

        {/* Queued success message */}
        {queuedMessage ? (
          <StatusLine tone="success" message={queuedMessage} style={styles.queuedBanner}>
            <MaterialCommunityIcons
              name="check-circle-outline"
              size={18}
              color={isDark ? darkColors.successDeep : colors.successDeep}
            />
            <Text
              style={[
                styles.queuedBannerText,
                { color: isDark ? darkColors.successDeep : colors.successDeep },
              ]}
            >
              {queuedMessage}
            </Text>
          </StatusLine>
        ) : null}

        {/* The scope the athlete recorded past: say where the ride is going. */}
        {ridingWithoutScope ? (
          <Text
            testID="review-stays-on-device"
            style={[styles.localOnly, { color: textSecondary }]}
          >
            {t('recording.savedLocallyNoScope')}
          </Text>
        ) : null}

        {unbackedRide ? (
          <StatusLine
            tone="error"
            message={t('recording.reviewNoBackup')}
            style={styles.noBackupBanner}
            testID="review-no-backup"
          >
            <MaterialCommunityIcons
              name="content-save-alert-outline"
              size={18}
              color={isDark ? darkColors.warningAmber : colors.warningAmber}
            />
            <Text
              style={[
                styles.queuedBannerText,
                { color: isDark ? darkColors.warningAmber : colors.warningAmber },
              ]}
            >
              {t('recording.reviewNoBackup')}
            </Text>
          </StatusLine>
        ) : null}

        {/* Error banner */}
        <SaveErrorBanner
          errorMessage={errorMessage}
          detail={errorDetail}
          showPermissionFix={showPermissionFix}
          isOAuthLoading={isOAuthLoading}
          onUpgradePermissions={handleUpgradeToOAuth}
          onRetry={canRetry ? handleSave : undefined}
          isRetrying={isUploading}
          onOpenRecording={
            keptRecording ? () => replaceTo(`/recordings/${keptRecording.id}`) : undefined
          }
          onShareFit={keptRecording?.kind === 'fit' ? shareKeptRecording : undefined}
          onFreeSpace={lowStorage ? () => tapTo('/cache-settings') : undefined}
        />

        {/* Action Buttons */}
        <View style={styles.actions}>
          <Button
            testID="review-save-button"
            label={t('common.save', 'Save')}
            onPress={handleSave}
            disabled={isProcessing}
            loading={isUploading}
          />

          {!isManual && (
            <Button
              testID="review-resume-button"
              label={t('recording.controls.resume')}
              variant="secondary"
              onPress={handleResume}
              disabled={isProcessing}
            />
          )}

          <Button
            testID="review-discard-button"
            label={t('recording.discard', 'Discard')}
            variant="destructive"
            opensConfirm
            onPress={handleDiscard}
            disabled={isProcessing}
          />
        </View>
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Bottom content
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  trimDelta: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  localOnly: {
    ...typography.caption,
    textAlign: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  // Activity type chip
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  typeText: {
    ...typography.body,
  },
  // Notes
  notesField: {
    marginTop: spacing.md,
  },
  // Banners
  queuedBannerText: {
    ...typography.caption,
    flex: 1,
  },
  queuedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colorWithOpacity(colors.success, 0.1),
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  noBackupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colorWithOpacity(colors.warning, 0.15),
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  // Actions
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});

export default withScreenBoundary(ReviewScreenContent, 'RecordingReview');
