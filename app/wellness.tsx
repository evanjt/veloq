import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  useColorScheme,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { WellnessDashboard, WellnessTrendsChart } from '@/components/wellness';
import { useWellness, type TimeRange } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { SMOOTHING_PRESETS, getSmoothingDescription, type SmoothingWindow } from '@/lib';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

export default function WellnessScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');
  const [smoothingWindow, setSmoothingWindow] = useState<SmoothingWindow>('auto');
  const [showSmoothingModal, setShowSmoothingModal] = useState(false);

  // isFetching is true during background refetches, isLoading only on initial load with no cache
  const { data: wellness, isLoading, isFetching, refetch } = useWellness(timeRange);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Only show full-page loading on very first load with no data at all
  const showFullPageLoading = isLoading && !wellness;
  // Show subtle indicator when fetching in background (time range change, etc)
  const showBackgroundLoading = isFetching && !isRefreshing && wellness;

  if (showFullPageLoading) {
    return (
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('wellnessScreen.title')}
          </Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>
          {t('wellnessScreen.title')}
        </Text>
        {/* Subtle loading indicator in header when fetching in background */}
        <View style={{ width: 48, alignItems: 'center' }}>
          {showBackgroundLoading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Today's trends summary */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <WellnessDashboard data={wellness} />
        </View>

        {/* Time range selector with smoothing config */}
        <View style={styles.timeRangeRow}>
          <View style={styles.timeRangeContainer}>
            {TIME_RANGES.map((range) => (
              <TouchableOpacity
                key={range.id}
                style={[
                  styles.timeRangeButton,
                  isDark && styles.timeRangeButtonDark,
                  timeRange === range.id && styles.timeRangeButtonActive,
                ]}
                onPress={() => setTimeRange(range.id)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.timeRangeText,
                    isDark && styles.timeRangeTextDark,
                    timeRange === range.id && styles.timeRangeTextActive,
                  ]}
                >
                  {range.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.smoothingButton, isDark && styles.smoothingButtonDark]}
            onPress={() => setShowSmoothingModal(true)}
            activeOpacity={0.7}
          >
            <IconButton
              icon="chart-bell-curve-cumulative"
              iconColor={
                smoothingWindow !== 'auto'
                  ? colors.primary
                  : isDark
                    ? darkColors.textSecondary
                    : colors.textSecondary
              }
              size={18}
              style={{ margin: 0 }}
            />
          </TouchableOpacity>
        </View>

        {/* Wellness Trends Chart */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <View style={styles.chartHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('wellnessScreen.trends')}
            </Text>
            <Text style={[styles.smoothingLabel, isDark && styles.textDark]}>
              {getSmoothingDescription(smoothingWindow, timeRange)}
            </Text>
          </View>
          <WellnessTrendsChart
            data={wellness}
            height={200}
            timeRange={timeRange}
            smoothingWindow={smoothingWindow}
          />
        </View>
      </ScrollView>

      {/* Smoothing Config Modal */}
      <Modal
        visible={showSmoothingModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSmoothingModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSmoothingModal(false)}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <Text style={[styles.modalTitle, isDark && styles.textLight]}>
              {t('wellness.smoothingTitle' as never)}
            </Text>
            <Text style={[styles.modalDescription, isDark && styles.textDark]}>
              {t('wellness.smoothingDescription' as never)}
            </Text>
            <View style={styles.smoothingOptions}>
              {SMOOTHING_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={String(preset.value)}
                  style={[
                    styles.smoothingOption,
                    isDark && styles.smoothingOptionDark,
                    smoothingWindow === preset.value && styles.smoothingOptionActive,
                  ]}
                  onPress={() => {
                    setSmoothingWindow(preset.value);
                    setShowSmoothingModal(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.smoothingOptionText,
                      isDark && styles.smoothingOptionTextDark,
                      smoothingWindow === preset.value && styles.smoothingOptionTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.modalHint, isDark && styles.textDark]}>
              {t('wellness.smoothingHint' as never)}
            </Text>
          </View>
        </Pressable>
      </Modal>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  smoothingLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  timeRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  smoothingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smoothingButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 320,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalDescription: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  smoothingOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  smoothingOption: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  smoothingOptionDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  smoothingOptionActive: {
    backgroundColor: colors.primary,
  },
  smoothingOptionText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  smoothingOptionTextDark: {
    color: darkColors.textSecondary,
  },
  smoothingOptionTextActive: {
    color: colors.textOnDark,
  },
  modalHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
