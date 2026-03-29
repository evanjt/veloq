import React, { useCallback } from 'react';
import { Modal, View, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography, opacity, shadows } from '@/theme';
import { navigateTo } from '@/lib';
import type { Insight } from '@/types';

const WEEK_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MIN_BUBBLE_SIZE = 8;
const MAX_BUBBLE_SIZE = 36;

const SHEET_HEIGHT = Dimensions.get('window').height * 0.85;

// "Your typical week" sub-component: 7 columns with proportionally-sized bubbles
const TypicalWeekChart = React.memo(function TypicalWeekChart({
  sparklineData,
  sparklineLabel,
  highlightDay,
  isDark,
}: {
  sparklineData?: number[];
  sparklineLabel?: string;
  highlightDay: number;
  isDark: boolean;
}) {
  if (!sparklineData || sparklineLabel !== 'typical_week' || sparklineData.length !== 7) {
    return null;
  }

  const maxCount = Math.max(...sparklineData, 1);
  const hasData = sparklineData.some((v) => v > 0);
  if (!hasData) return null;

  const bubbleColor = '#AB47BC';
  const emptyColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={[typicalWeekStyles.container, isDark && typicalWeekStyles.containerDark]}>
      <Text style={[typicalWeekStyles.heading, isDark && typicalWeekStyles.headingDark]}>
        Your typical week
      </Text>
      <View style={typicalWeekStyles.columns}>
        {WEEK_DAY_LABELS.map((label, i) => {
          const count = sparklineData[i];
          const isHighlight = i === highlightDay;
          const size =
            count > 0
              ? MIN_BUBBLE_SIZE + (count / maxCount) * (MAX_BUBBLE_SIZE - MIN_BUBBLE_SIZE)
              : MIN_BUBBLE_SIZE;

          return (
            <View key={label} style={typicalWeekStyles.column}>
              <View style={typicalWeekStyles.bubbleWrapper}>
                <View
                  style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: count > 0 ? bubbleColor : emptyColor,
                    opacity: count > 0 ? 0.4 + 0.6 * (count / maxCount) : 1,
                    borderWidth: isHighlight ? 2 : 0,
                    borderColor: isHighlight ? bubbleColor : 'transparent',
                  }}
                />
              </View>
              {count > 0 ? (
                <Text
                  style={[typicalWeekStyles.countLabel, isDark && typicalWeekStyles.countLabelDark]}
                >
                  {count}
                </Text>
              ) : null}
              <Text
                style={[
                  typicalWeekStyles.dayLabel,
                  isDark && typicalWeekStyles.dayLabelDark,
                  isHighlight && { fontWeight: '700', color: bubbleColor },
                ]}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
});

const typicalWeekStyles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: opacity.overlay.subtle,
  },
  containerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  headingDark: {
    color: darkColors.textSecondary,
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  column: {
    alignItems: 'center',
    gap: 4,
  },
  bubbleWrapper: {
    width: MAX_BUBBLE_SIZE,
    height: MAX_BUBBLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  countLabelDark: {
    color: darkColors.textSecondary,
  },
  dayLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  dayLabelDark: {
    color: darkColors.textMuted,
  },
});

interface PatternDetailSheetProps {
  insight: Insight | null;
  visible: boolean;
  onClose: () => void;
}

export const PatternDetailSheet = React.memo(function PatternDetailSheet({
  insight,
  visible,
  onClose,
}: PatternDetailSheetProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const handleViewDetails = useCallback(() => {
    if (insight?.navigationTarget) {
      navigateTo(insight.navigationTarget);
    }
  }, [insight?.navigationTarget]);

  const handleSectionPress = useCallback((sectionId: string) => {
    navigateTo(`/section/${sectionId}`);
  }, []);

  if (!insight) return null;

  const hasSections =
    insight.supportingData?.sections && insight.supportingData.sections.length > 0;
  const activityCount = insight.supportingData?.activities?.length;

  // Extract pattern details from supporting data points
  const dayPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.label.toLowerCase().includes('day') || dp.label.toLowerCase().includes('pattern')
  );
  const sportPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.label.toLowerCase().includes('sport') || dp.label.toLowerCase().includes('type')
  );
  const durationPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.label.toLowerCase().includes('duration') || dp.label.toLowerCase().includes('time')
  );

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.backdropFill} />
      </Pressable>
      <View
        style={[styles.sheet, isDark && styles.sheetDark, { height: SHEET_HEIGHT }]}
        testID="pattern-detail-sheet"
      >
        {/* Drag handle */}
        <View style={styles.handleContainer}>
          <View style={[styles.handle, isDark && styles.handleDark]} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          nestedScrollEnabled={true}
        >
          {/* Header row */}
          <View style={styles.headerRow}>
            <View style={[styles.iconCircle, { backgroundColor: `${insight.iconColor}1F` }]}>
              <MaterialCommunityIcons
                name={insight.icon as never}
                size={16}
                color={insight.iconColor}
              />
            </View>
            <Text style={[styles.title, isDark && styles.titleDark]} numberOfLines={2}>
              {insight.title}
            </Text>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons
                name="close"
                size={20}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </Pressable>
          </View>

          {/* Pattern summary */}
          <View style={[styles.patternSummary, isDark && styles.patternSummaryDark]}>
            {dayPoint ? (
              <View style={styles.patternRow}>
                <MaterialCommunityIcons
                  name="calendar-clock"
                  size={18}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.patternLabel, isDark && styles.patternLabelDark]}>
                  {dayPoint.label}
                </Text>
                <Text style={[styles.patternValue, isDark && styles.patternValueDark]}>
                  {String(dayPoint.value)}
                </Text>
              </View>
            ) : null}
            {sportPoint ? (
              <View style={styles.patternRow}>
                <MaterialCommunityIcons
                  name="run"
                  size={18}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.patternLabel, isDark && styles.patternLabelDark]}>
                  {sportPoint.label}
                </Text>
                <Text style={[styles.patternValue, isDark && styles.patternValueDark]}>
                  {String(sportPoint.value)}
                </Text>
              </View>
            ) : null}
            {durationPoint ? (
              <View style={styles.patternRow}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={18}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.patternLabel, isDark && styles.patternLabelDark]}>
                  {durationPoint.label}
                </Text>
                <Text style={[styles.patternValue, isDark && styles.patternValueDark]}>
                  {String(durationPoint.value)}
                  {durationPoint.unit ? ` ${durationPoint.unit}` : ''}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Your typical week — bubble chart */}
          <TypicalWeekChart
            sparklineData={insight.supportingData?.sparklineData}
            sparklineLabel={insight.supportingData?.sparklineLabel}
            highlightDay={
              dayPoint
                ? WEEK_DAY_LABELS.findIndex((d) =>
                    String(dayPoint.value).toLowerCase().startsWith(d.toLowerCase().slice(0, 3))
                  )
                : -1
            }
            isDark={isDark}
          />

          {/* Activity count header */}
          {activityCount != null && activityCount > 0 ? (
            <Text style={[styles.activityCountHeader, isDark && styles.activityCountHeaderDark]}>
              {t('insights.basedOnActivities', {
                defaultValue: 'Based on {{count}} activities',
                count: activityCount,
              })}
            </Text>
          ) : insight.subtitle ? (
            <Text style={[styles.activityCountHeader, isDark && styles.activityCountHeaderDark]}>
              {insight.subtitle}
            </Text>
          ) : null}

          {/* Section links */}
          {hasSections ? (
            <View style={styles.sectionsContainer}>
              {insight.supportingData!.sections!.map((section) => {
                const trendIcon =
                  section.trend != null && section.trend > 0
                    ? 'trending-up'
                    : section.trend != null && section.trend < 0
                      ? 'trending-down'
                      : 'minus';
                const trendColor =
                  section.trend != null && section.trend > 0
                    ? colors.success
                    : section.trend != null && section.trend < 0
                      ? colors.warning
                      : isDark
                        ? darkColors.textSecondary
                        : colors.textSecondary;

                return (
                  <Pressable
                    key={section.sectionId}
                    style={[styles.sectionCard, isDark && styles.sectionCardDark]}
                    onPress={() => handleSectionPress(section.sectionId)}
                  >
                    <View style={styles.sectionContent}>
                      <Text
                        style={[styles.sectionName, isDark && styles.sectionNameDark]}
                        numberOfLines={1}
                      >
                        {section.sectionName}
                      </Text>
                      <View style={styles.sectionMeta}>
                        {section.traversalCount != null ? (
                          <Text
                            style={[
                              styles.sectionTraversals,
                              isDark && styles.sectionTraversalsDark,
                            ]}
                          >
                            {section.traversalCount}x
                          </Text>
                        ) : null}
                        <MaterialCommunityIcons
                          name={trendIcon as never}
                          size={16}
                          color={trendColor}
                        />
                      </View>
                    </View>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={18}
                      color={isDark ? darkColors.textSecondary : colors.textSecondary}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* View details button */}
          {insight.navigationTarget ? (
            <Pressable style={styles.viewDetailsButton} onPress={handleViewDetails}>
              <Text style={styles.viewDetailsText}>
                {t('insights.viewDetails', 'View details')} {'\u2192'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  backdropFill: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetDark: {
    backgroundColor: darkColors.surface,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray300,
  },
  handleDark: {
    backgroundColor: darkColors.borderLight,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacing.xs,
  },
  title: {
    ...typography.cardTitle,
    flex: 1,
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  // Pattern summary
  patternSummary: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: opacity.overlay.subtle,
    gap: spacing.sm,
  },
  patternSummaryDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  patternLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  patternLabelDark: {
    color: darkColors.textSecondary,
  },
  patternValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  patternValueDark: {
    color: darkColors.textPrimary,
  },
  // Activity count
  activityCountHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  activityCountHeaderDark: {
    color: darkColors.textSecondary,
  },
  // Sections
  sectionsContainer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: spacing.xs,
  },
  sectionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTraversals: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sectionTraversalsDark: {
    color: darkColors.textSecondary,
  },
  // View details
  viewDetailsButton: {
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  viewDetailsText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FC4C02',
  },
});
