import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { replaceTo } from '@/shared/app/navigation';
import { colors, colorWithOpacity, darkColors, spacing, layout, typography } from '@/theme';
import { Button, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';

import {
  useRecordingStore,
  useUploadPermissionStore,
  useReviewSave,
  useActivitySummary,
  useDiscardWithAnimation,
  resumeStoppedRecording,
  useActivityNameGeneration,
  getTimeOfDayKey,
  ReviewMapHero,
  ActivityStatsCard,
  SaveErrorBanner,
} from '@/features/recording';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { ActivityTypeSheetInput } from '@/app/sheets/activity-type';
import type { ActivityType } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const MAP_FRACTION = 0.45;

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
  }>();

  const isManual = params.manual === 'true';
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

  const [notes, setNotes] = useState(params.notes ?? '');
  const [selectedType, setSelectedType] = useState<ActivityType>(
    activityType ?? ('Ride' as ActivityType)
  );
  const { name, setName } = useActivityNameGeneration({
    initialName: params.name,
    startTime,
    type: selectedType,
  });

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(Math.max(0, (streams.latlng?.length ?? 0) - 1));
  // What the map draws. It follows the released handle, not the finger.
  const [mapTrim, setMapTrim] = useState<[number, number]>([
    0,
    Math.max(0, (streams.latlng?.length ?? 0) - 1),
  ]);

  const type = selectedType;
  const canTrim = !isManual && (streams.latlng?.length ?? 0) > 2;
  const hasGps = !isManual && (streams.latlng?.length ?? 0) >= 2;

  const handleTrimChange = useCallback((startIdx: number, endIdx: number) => {
    setTrimStart(startIdx);
    setTrimEnd(endIdx);
  }, []);

  const handleTrimCommit = useCallback((startIdx: number, endIdx: number) => {
    setMapTrim([startIdx, endIdx]);
  }, []);

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
    queuedMessage,
    showPermissionFix,
    isOAuthLoading,
    handleUpgradeToOAuth,
    canRetry,
  } = useReviewSave({
    isManual,
    type,
    name,
    summary,
    notes,
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

  // Hold-to-discard extracted to useDiscardWithAnimation
  const { discardAnim, handleDiscardPressIn, handleDiscardPressOut } = useDiscardWithAnimation();

  const openSheet = useSheetOpener();
  const openTypePicker = useCallback(async () => {
    const result = await openSheet<ActivityTypeSheetInput, ActivityType>('sheets/activity-type', {
      selectedType: type,
      mode: 'review',
    });
    if (result.kind === 'selected') setSelectedType(result.value);
  }, [openSheet, type]);

  const handleResume = useCallback(() => {
    resumeStoppedRecording().catch(() => {});
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const activityColor = getActivityColor(type);
  const isProcessing = isUploading;
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = hasGps ? windowHeight * MAP_FRACTION : 0;

  if (!ownedReview) return null;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* A GPS recording opens on a map hero that runs under the status bar and
          carries its own back control, so the native header is off there. The
          non-GPS screen takes it, and loses it while an upload is in flight,
          which is what the old header's disabled back button did. */}
      <Stack.Screen
        options={{
          headerShown: !hasGps,
          headerBackVisible: !isProcessing,
          gestureEnabled: !isProcessing,
        }}
      />
      {/* Map hero (top portion) */}
      {hasGps && (
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
          onBack={handleBack}
          disabled={isProcessing}
        />
      )}

      {/* Bottom sheet content */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Activity Name */}
        <TextInput
          testID="review-activity-name"
          style={[
            styles.nameInput,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={name}
          onChangeText={setName}
          placeholder={`${t(`recording.timeOfDay.${getTimeOfDayKey(startTime)}`)} ${t(`activityTypes.${type}`, type.replace(/([A-Z])/g, ' $1').trim())}`}
          placeholderTextColor={textSecondary}
          editable={!isProcessing}
        />

        {/* Compact stat row */}
        <ActivityStatsCard
          summary={summary}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
        />

        {/* Trim delta feedback */}
        {trimDelta && (
          <Text style={[styles.trimDelta, { color: textSecondary }]}>
            {t('recording.trimmed', 'Trimmed')}: {formatDistance(trimDelta.distance, isMetric)},{' '}
            {formatDuration(trimDelta.duration)}
          </Text>
        )}

        {/* Activity Type (tappable) */}
        <TouchableOpacity
          testID="review-activity-type"
          style={[styles.typeChip, { backgroundColor: surface, borderColor: border }]}
          onPress={() => !isProcessing && openTypePicker()}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name={getActivityIcon(type)} size={20} color={activityColor} />
          <Text style={[styles.typeText, { color: textPrimary }]}>
            {t(`activityTypes.${type}`, type)}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={textSecondary} />
        </TouchableOpacity>

        {/* Notes */}
        <TextInput
          testID="review-notes"
          style={[
            styles.notesInput,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('recording.notesPlaceholder', 'How did it feel?')}
          placeholderTextColor={textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          editable={!isProcessing}
        />

        {/* Queued success message */}
        {queuedMessage && (
          <View style={styles.queuedBanner}>
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
          </View>
        )}

        {/* The scope the athlete recorded past: say where the ride is going. */}
        {ridingWithoutScope && (
          <Text
            testID="review-stays-on-device"
            style={[styles.localOnly, { color: textSecondary }]}
          >
            {t('recording.savedLocallyNoScope')}
          </Text>
        )}

        {/* Error banner */}
        <SaveErrorBanner
          errorMessage={errorMessage}
          showPermissionFix={showPermissionFix}
          isOAuthLoading={isOAuthLoading}
          onUpgradePermissions={handleUpgradeToOAuth}
          onRetry={canRetry ? handleSave : undefined}
          isRetrying={isUploading}
        />

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            testID="review-save-button"
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleSave}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>{t('common.save', 'Save')}</Text>
            )}
          </TouchableOpacity>

          {!isManual && (
            <Button
              testID="review-resume-button"
              label={t('recording.controls.resume')}
              variant="secondary"
              onPress={handleResume}
              disabled={isProcessing}
            />
          )}

          {/* Hold-to-discard */}
          <Animated.View
            testID="review-discard-button"
            style={[
              styles.dangerBtn,
              {
                borderColor: discardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [colorWithOpacity(colors.error, 0.3), colors.error],
                }),
                borderWidth: 1,
                overflow: 'hidden' as const,
              },
            ]}
            onTouchStart={isProcessing ? undefined : handleDiscardPressIn}
            onTouchEnd={handleDiscardPressOut}
            onTouchCancel={handleDiscardPressOut}
          >
            <Animated.View
              style={{
                position: 'absolute' as const,
                left: 0,
                top: 0,
                bottom: 0,
                backgroundColor: colors.error,
                opacity: 0.15,
                width: discardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              }}
            />
            <Text style={[styles.dangerBtnText, isDark && styles.dangerBtnTextDark]}>
              {t('recording.discard', 'Discard')}
            </Text>
          </Animated.View>
        </View>
      </ScrollView>
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
  nameInput: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
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
  notesInput: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 60,
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
  // Actions
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  primaryBtn: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  primaryBtnText: {
    ...typography.bodyBold,
    color: colors.textOnPrimary,
  },
  dangerBtn: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  dangerBtnText: {
    ...typography.bodyBold,
    color: colors.errorDeep,
  },
  dangerBtnTextDark: {
    color: darkColors.errorDeep,
  },
});

export default withScreenBoundary(ReviewScreenContent, 'RecordingReview');
