import React, { useCallback } from 'react';
import { Modal, View, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography, opacity } from '@/theme';
import { AlternativesCarousel } from './AlternativesCarousel';
import { SupportingDataSection } from './SupportingDataSection';
import { MethodologySection } from './MethodologySection';
import type { Insight } from '@/types';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.85;

interface InsightDetailSheetProps {
  insight: Insight | null;
  visible: boolean;
  onClose: () => void;
}

export const InsightDetailSheet = React.memo(function InsightDetailSheet({
  insight,
  visible,
  onClose,
}: InsightDetailSheetProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const handleSectionPress = useCallback(
    (sectionId: string) => {
      onClose();
      router.push(`/section/${sectionId}` as never);
    },
    [onClose, router]
  );

  if (!insight) return null;

  const hasAlternatives = insight.alternatives && insight.alternatives.length > 0;
  const hasSupportingData = insight.supportingData != null;
  const hasMethodology = insight.methodology != null;
  const hasSectionLinks =
    insight.supportingData?.sections && insight.supportingData.sections.length > 0;

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
            {insight.subtitle ? (
              <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
                {insight.subtitle}
              </Text>
            ) : null}
            {insight.body ? (
              <Text style={[styles.body, isDark && styles.bodyDark]}>{insight.body}</Text>
            ) : null}
          </View>

          {/* Alternatives Carousel */}
          {hasAlternatives ? <AlternativesCarousel alternatives={insight.alternatives!} /> : null}

          {/* Supporting Data */}
          {hasSupportingData ? (
            <View style={styles.section}>
              <SupportingDataSection data={insight.supportingData!} />
            </View>
          ) : null}

          {/* Methodology */}
          {hasMethodology ? (
            <View style={styles.section}>
              <MethodologySection methodology={insight.methodology!} />
            </View>
          ) : null}

          {/* Section links */}
          {hasSectionLinks ? (
            <View style={styles.exploreSection}>
              {insight.supportingData!.sections!.map((section) => (
                <Pressable
                  key={section.sectionId}
                  style={[styles.exploreSectionLink, isDark && styles.exploreSectionLinkDark]}
                  onPress={() => handleSectionPress(section.sectionId)}
                >
                  <Text
                    style={[styles.exploreSectionName, isDark && styles.exploreSectionNameDark]}
                    numberOfLines={1}
                  >
                    {section.sectionName}
                  </Text>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={18}
                    color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  />
                </Pressable>
              ))}
            </View>
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
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  bodyDark: {
    color: darkColors.textSecondary,
  },
  // Content sections
  section: {
    paddingHorizontal: spacing.lg,
  },
  // Explore
  exploreSection: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  exploreSectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  exploreSectionLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  exploreSectionName: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  exploreSectionNameDark: {
    color: darkColors.textPrimary,
  },
});
