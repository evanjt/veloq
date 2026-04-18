import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { formatDistance, formatDuration } from '@/lib';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';

import { useRecordingStore } from '@/providers/RecordingStore';
import { useReviewSave } from '@/hooks/recording/useReviewSave';
import { useActivitySummary } from '@/hooks/recording/useActivitySummary';
import { useDiscardWithAnimation } from '@/hooks/recording/useDiscardWithAnimation';
import {
  useActivityNameGeneration,
  getTimeOfDayKey,
} from '@/hooks/recording/useActivityNameGeneration';
import { ReviewMapHero } from '@/components/recording/ReviewMapHero';
import { RpeSlider } from '@/components/recording/RpeSlider';
import { ActivityTypePickerModal } from '@/components/recording/ActivityTypePickerModal';
import { ActivityStatsCard } from '@/components/recording/ActivityStatsCard';
import { SaveErrorBanner } from '@/components/recording/SaveErrorBanner';
import type { ActivityType } from '@/types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAP_FRACTION = 0.45;

export default function ReviewScreen() {
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
  const activityType = useRecordingStore((s) => s.activityType);
  const streams = useRecordingStore((s) => s.streams);
  const laps = useRecordingStore((s) => s.laps);
  const startTime = useRecordingStore((s) => s.startTime);
  const stopTime = useRecordingStore((s) => s.stopTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const pairedEventId = useRecordingStore((s) => s.pairedEventId);

  const [notes, setNotes] = useState(params.notes ?? '');
  const [rpe, setRpe] = useState(5);
  const [selectedType, setSelectedType] = useState<ActivityType>(
    activityType ?? ('Ride' as ActivityType)
  );
  const { name, setName } = useActivityNameGeneration({
    initialName: params.name,
    type: selectedType,
  });
  const [showTypeModal, setShowTypeModal] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(
    (streams.latlng?.length ?? 0) > 0 ? streams.latlng!.length - 1 : 0
  );

  const type = selectedType;
  const canTrim = !isManual && (streams.latlng?.length ?? 0) > 2;
  const hasGps = !isManual && (streams.latlng?.length ?? 0) >= 2;

  const handleTrimChange = useCallback((startIdx: number, endIdx: number) => {
    setTrimStart(startIdx);
    setTrimEnd(endIdx);
  }, []);

  // Summary, trim delta, and trimmed-stream accessor extracted to useActivitySummary
  const { summary, trimDelta, getTrimmedStreams } = useActivitySummary({
    streams,
    startTime,
    stopTime,
    pausedDuration,
    trimStart,
    trimEnd,
    canTrim,
    isManual,
    params,
  });

  // Save/upload orchestration extracted to useReviewSave
  const {
    handleSave,
    isUploading,
    errorMessage,
    queuedMessage,
    showPermissionFix,
    isOAuthLoading,
    handleUpgradeToOAuth,
  } = useReviewSave({
    isManual,
    type,
    name,
    summary,
    notes,
    startTime,
    laps,
    pairedEventId,
    getTrimmedStreams,
    canTrim,
  });

  // Hold-to-discard extracted to useDiscardWithAnimation
  const { discardAnim, handleDiscardPressIn, handleDiscardPressOut } = useDiscardWithAnimation();

  const handleTypeSelect = useCallback((item: ActivityType) => {
    setSelectedType(item);
    setShowTypeModal(false);
  }, []);

  const handleCloseTypeModal = useCallback(() => {
    setShowTypeModal(false);
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
  const mapHeight = hasGps ? SCREEN_HEIGHT * MAP_FRACTION : 0;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Map hero (top portion) */}
      {hasGps && (
        <ReviewMapHero
          coordinates={streams.latlng}
          mapHeight={mapHeight}
          topInset={insets.top}
          canTrim={canTrim}
          trimStart={trimStart}
          trimEnd={trimEnd}
          totalDuration={summary.duration}
          totalPoints={streams.latlng.length}
          onTrimChange={handleTrimChange}
          onBack={handleBack}
          disabled={isProcessing}
        />
      )}

      {/* Header (only for non-GPS activities) */}
      {!hasGps && (
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            disabled={isProcessing}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isProcessing ? textSecondary : textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textPrimary }]}>
            {t('recording.reviewActivity', 'Review Activity')}
          </Text>
        </View>
      )}

      {/* Bottom sheet content */}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
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
          placeholder={`${t(`recording.timeOfDay.${getTimeOfDayKey()}`)} ${t(`activityTypes.${type}`, type.replace(/([A-Z])/g, ' $1').trim())}`}
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
          onPress={() => !isProcessing && setShowTypeModal(true)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name={getActivityIcon(type)} size={20} color={activityColor} />
          <Text style={[styles.typeText, { color: textPrimary }]}>
            {t(`activityTypes.${type}`, type)}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={textSecondary} />
        </TouchableOpacity>

        {/* RPE Slider — only for GPS activities; not applicable to manual entries */}
        {!isManual && (
          <RpeSlider value={rpe} onValueChange={setRpe} textSecondary={textSecondary} />
        )}

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
            <MaterialCommunityIcons name="check-circle-outline" size={18} color="#22C55E" />
            <Text style={styles.queuedBannerText}>{queuedMessage}</Text>
          </View>
        )}

        {/* Error banner */}
        <SaveErrorBanner
          errorMessage={errorMessage}
          showPermissionFix={showPermissionFix}
          isOAuthLoading={isOAuthLoading}
          onUpgradePermissions={handleUpgradeToOAuth}
        />

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            testID="review-save-button"
            style={[styles.primaryBtn, { backgroundColor: brand.teal }]}
            onPress={handleSave}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('common.save', 'Save')}</Text>
            )}
          </TouchableOpacity>

          {/* Hold-to-discard */}
          <Animated.View
            testID="review-discard-button"
            style={[
              styles.dangerBtn,
              {
                borderColor: discardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [`rgba(239,68,68,0.3)`, colors.error],
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
            <Text style={styles.dangerBtnText}>{t('recording.discard', 'Discard')}</Text>
          </Animated.View>
        </View>
      </ScrollView>

      {/* Activity Type Modal */}
      <ActivityTypePickerModal
        visible={showTypeModal}
        selectedType={type}
        onSelect={handleTypeSelect}
        onClose={handleCloseTypeModal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Non-GPS header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sectionTitle,
    marginLeft: spacing.xs,
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
  queuedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  queuedBannerText: {
    ...typography.caption,
    color: '#22C55E',
    flex: 1,
  },
  // Actions
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  primaryBtn: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  primaryBtnText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
  },
  dangerBtn: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  dangerBtnText: {
    ...typography.bodyBold,
    color: colors.error,
  },
});
