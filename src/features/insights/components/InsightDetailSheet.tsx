import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { tapTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import * as haptics from '@/shared/ui/haptics';
import {
  colors,
  darkColors,
  spacing,
  typography,
  opacity,
  colorWithOpacity,
  layout,
  insightToneColor,
} from '@/theme';
import { InsightDetailContent } from './content/InsightDetailContent';
import { MethodologySection } from './MethodologySection';
import type { Insight } from '@/types';
import { pressable, pressRipple } from '@/shared/ui';

interface InsightDetailSheetProps {
  insight: Insight;
  onClose: () => void;
}

export const InsightDetailSheet = React.memo(function InsightDetailSheet({
  insight,
  onClose,
}: InsightDetailSheetProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    haptics.light();
    onClose();
  }, [onClose]);

  const handleNavigate = useCallback(() => {
    if (insight?.navigationTarget) {
      onClose();
      tapTo(insight.navigationTarget);
    }
  }, [insight?.navigationTarget, onClose]);

  const toneColor = insightToneColor(insight.iconTone, isDark);

  // Content components for these categories already have embedded navigation
  // (e.g. tappable section names that go straight to the section detail page).
  const contentHandlesNav =
    insight.category === 'section_pr' ||
    insight.category === 'section_trend' ||
    insight.category === 'route';
  const hasNavTarget = !!insight.navigationTarget && !contentHandlesNav;

  return (
    <View style={[styles.sheet, isDark && styles.sheetDark]} testID="insight-detail-sheet">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled={true}
      >
        {/* Compact header row */}
        <View style={styles.headerRow}>
          <View style={[styles.iconCircle, { backgroundColor: colorWithOpacity(toneColor, 0.12) }]}>
            <MaterialCommunityIcons name={insight.icon as never} size={16} color={toneColor} />
          </View>
          <Text style={[styles.title, isDark && styles.titleDark]} numberOfLines={2}>
            {insight.title}
          </Text>
          <Pressable
            style={pressable(styles.closeButton)}
            android_ripple={pressRipple}
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
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

        {/* Methodology transparency - single "How was this calculated?" block */}
        {insight.methodology ||
        insight.meta?.ranking ||
        insight.supportingData?.formula ||
        insight.supportingData?.algorithmDescription ? (
          <View style={styles.methodologySection}>
            <MethodologySection insight={insight} />
          </View>
        ) : null}

        {/* Navigation link */}
        {hasNavTarget ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('insights.viewInDetail')}
            style={pressable([styles.navLink, isDark && styles.navLinkDark])}
            android_ripple={pressRipple}
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
  );
});

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  sheetDark: {
    backgroundColor: darkColors.surface,
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
    borderRadius: layout.borderRadiusFull,
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
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  body: {
    fontSize: typography.bodySmall.fontSize,
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
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.subtle,
  },
  navLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  navLinkText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  navLinkTextDark: {
    color: darkColors.textPrimary,
  },
});
