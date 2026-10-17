import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { tapTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import * as haptics from '@/shared/ui/haptics';
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
import { viewInDetailTarget } from '../lib/dataLink';
import type { Insight } from '@/types';
import { pressable, pressRipple, SheetHeader, SheetScrollView } from '@/shared/ui';

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

  const detailTarget = viewInDetailTarget(insight);
  const handleNavigate = useCallback(() => {
    if (detailTarget) {
      onClose();
      tapTo(detailTarget);
    }
  }, [detailTarget, onClose]);

  const toneColor = insightToneColor(insight.iconTone, isDark);

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
      nestedScrollEnabled={true}
    >
      <SheetHeader
        title={insight.title}
        subtitle={insight.subtitle}
        onClose={handleClose}
        titleTestID="insight-detail-title"
        leading={
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: colorWithOpacity(toneColor, opacity.tint2) },
            ]}
          >
            <MaterialCommunityIcons
              name={insight.icon as never}
              size={iconSize.sm}
              color={toneColor}
            />
          </View>
        }
      />

      {/* Body text */}
      {insight.body ? (
        <Text style={[styles.body, isDark && styles.bodyDark]}>{insight.body}</Text>
      ) : null}

      {/* Category-specific content (charts, sparklines, data) */}
      <View style={styles.contentSection}>
        <InsightDetailContent insight={insight} />
      </View>

      {/* The numbers, the method and the link to the data, folded */}
      <View style={styles.methodologySection}>
        <MethodologySection insight={insight} onLeave={onClose} />
      </View>

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
            size={iconSize.md}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
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
