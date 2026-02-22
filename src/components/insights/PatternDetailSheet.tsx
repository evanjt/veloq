import React, { useCallback } from 'react';
import { Modal, View, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography, opacity, shadows } from '@/theme';
import type { Insight } from '@/types';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.85;

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
  const router = useRouter();

  const handleViewDetails = useCallback(() => {
    if (insight?.navigationTarget) {
      onClose();
      router.push(insight.navigationTarget as never);
    }
  }, [insight?.navigationTarget, onClose, router]);

  const handleSectionPress = useCallback(
    (sectionId: string) => {
      onClose();
      router.push(`/section/${sectionId}` as never);
    },
    [onClose, router]
  );

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
      <View style={[styles.sheet, isDark && styles.sheetDark, { height: SHEET_HEIGHT }]}>
        {/* Drag handle */}
        <View style={styles.handleContainer}>
          <View style={[styles.handle, isDark && styles.handleDark]} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Hero banner */}
          <View style={[styles.hero, { backgroundColor: insight.iconColor }]}>
            <MaterialCommunityIcons name={insight.icon as never} size={40} color="#FFFFFF" />
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* Title + confidence */}
          <View style={styles.titleSection}>
            <Text style={[styles.title, isDark && styles.titleDark]}>{insight.title}</Text>
            {insight.confidence != null ? (
              <View style={[styles.confidenceBadge, isDark && styles.confidenceBadgeDark]}>
                <Text style={[styles.confidenceText, isDark && styles.confidenceTextDark]}>
                  {Math.round(insight.confidence * 100)}% {t('insights.confident', 'confident')}
                </Text>
              </View>
            ) : null}
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
    backgroundColor: '#FFFFFF',
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
    paddingBottom: spacing.xxl,
  },
  // Hero
  hero: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
    zIndex: 1,
  },
  // Title
  titleSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  confidenceBadge: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    backgroundColor: opacity.overlay.subtle,
  },
  confidenceBadgeDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  confidenceTextDark: {
    color: darkColors.textSecondary,
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
    backgroundColor: '#FFFFFF',
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
