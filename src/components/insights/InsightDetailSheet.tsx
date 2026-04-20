import React, { useCallback } from 'react';
import { Modal, View, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/lib';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography, opacity, colorWithOpacity } from '@/theme';
import { InsightDetailContent } from './content/InsightDetailContent';
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

  const handleNavigate = useCallback(() => {
    if (insight?.navigationTarget) {
      onClose();
      navigateTo(insight.navigationTarget);
    }
  }, [insight?.navigationTarget, onClose]);

  if (!insight) return null;

  // Content components for these categories already have embedded navigation
  const contentHandlesNav = insight.category === 'section_pr' || insight.category === 'stale_pr';
  const hasNavTarget = !!insight.navigationTarget && !contentHandlesNav;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.backdropFill} />
      </Pressable>
      <View
        style={[styles.sheet, isDark && styles.sheetDark, { height: SHEET_HEIGHT }]}
        testID="insight-detail-sheet"
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
          {/* Compact header row */}
          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colorWithOpacity(insight.iconColor, 0.12) },
              ]}
            >
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

          {/* Subtitle */}
          {insight.subtitle ? (
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>{insight.subtitle}</Text>
          ) : null}

          {/* Body text */}
          {insight.body ? (
            <Text style={[styles.body, isDark && styles.bodyDark]}>{insight.body}</Text>
          ) : null}

          {/* Category-specific content (charts, sparklines, data) */}
          <View style={styles.contentSection}>
            <InsightDetailContent insight={insight} />
          </View>

          {/* Methodology transparency — single "How was this calculated?" block */}
          {insight.methodology ||
          insight.supportingData?.formula ||
          insight.supportingData?.algorithmDescription ? (
            <View style={styles.methodologySection}>
              <MethodologySection insight={insight} />
            </View>
          ) : null}

          {/* Navigation link */}
          {hasNavTarget ? (
            <Pressable
              style={[styles.navLink, isDark && styles.navLinkDark]}
              onPress={handleNavigate}
            >
              <Text style={[styles.navLinkText, isDark && styles.navLinkTextDark]}>
                {t('insights.viewInDetail')}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
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
  // Compact header
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
  title: {
    ...typography.cardTitle,
    flex: 1,
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  // Text
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  bodyDark: {
    color: darkColors.textSecondary,
  },
  // Content
  contentSection: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  // Methodology
  methodologySection: {
    paddingHorizontal: spacing.lg,
  },
  // Navigation
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  navLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  navLinkText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  navLinkTextDark: {
    color: darkColors.textPrimary,
  },
});
