import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  insightToneColor,
  layout,
  opacity,
  spacing,
  typography,
} from '@/theme';
import { InsightDetailContent } from './content/InsightDetailContent';
import { MethodologySection } from './MethodologySection';
import { InsightSheetContext } from './InsightSheetContext';
import { viewInDetailTarget } from '../lib/dataLink';
import type { Insight } from '@/types';
import { SheetHeader, SheetScrollView, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';

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

  const detailTarget = viewInDetailTarget(insight);
  const handleNavigate = useCallback(() => {
    if (detailTarget) {
      onClose();
      navigateTo(detailTarget);
    }
  }, [detailTarget, onClose]);

  const toneColor = insightToneColor(insight.iconTone, isDark);
  const sheet = useMemo(() => ({ insight, onLeave: onClose }), [insight, onClose]);

  // Only content that links each of its rows to its own screen may hide the
  // button. A section PR sheet has no such link, so it keeps View in detail.
  const contentHandlesNav = insight.category === 'section_trend' || insight.category === 'route';
  const hasNavTarget = detailTarget != null && !contentHandlesNav;

  return (
    <SheetScrollView
      testID="insight-detail-sheet"
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <SheetHeader
        title={insight.title}
        subtitle={insight.subtitle}
        onClose={onClose}
        titleTestID="insight-detail-title"
        leading={
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: colorWithOpacity(toneColor, opacity.tint2) },
            ]}
          >
            <Icon name={insight.icon as never} size={iconSize.sm} color={toneColor} />
          </View>
        }
      />

      {/* Body text */}
      {insight.body ? (
        <Text style={[styles.body, isDark && styles.bodyDark]}>{insight.body}</Text>
      ) : null}

      {/* Category-specific content (charts, sparklines, data) */}
      <View style={styles.contentSection}>
        <InsightSheetContext.Provider value={sheet}>
          <InsightDetailContent insight={insight} />
        </InsightSheetContext.Provider>
      </View>

      {/* The numbers, the method and the link to the data, folded */}
      <View style={styles.methodologySection}>
        <MethodologySection insight={insight} onLeave={onClose} />
      </View>

      {/* Navigation link */}
      {hasNavTarget ? (
        <PressTarget
          accessibilityRole="button"
          accessibilityLabel={t('insights.viewInDetail')}
          style={[styles.navLink, isDark && styles.navLinkDark]}
          onPress={handleNavigate}
        >
          <Text style={[styles.navLinkText, isDark && styles.navLinkTextDark]}>
            {t('insights.viewInDetail')}
          </Text>
          <Icon
            name="chevron-right"
            size={iconSize.md}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </PressTarget>
      ) : null}
    </SheetScrollView>
  );
});

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Text
  body: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    paddingHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
  },
  bodyDark: {
    color: darkColors.textSecondary,
  },
  // Content
  contentSection: {
    paddingHorizontal: layout.screenPadding,
    marginTop: spacing.xs,
  },
  // Methodology
  methodologySection: {
    paddingHorizontal: layout.screenPadding,
  },
  // Navigation
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: layout.screenPadding,
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
    ...typography.bodySmallBold,
    color: colors.textPrimary,
  },
  navLinkTextDark: {
    color: darkColors.textPrimary,
  },
});
