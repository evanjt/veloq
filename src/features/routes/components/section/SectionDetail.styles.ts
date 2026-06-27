import { StyleSheet } from 'react-native';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  actionPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  actionCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  acceptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  acceptText: {
    fontSize: 13,
    fontWeight: '500',
  },
  pinnedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pinnedText: {
    fontSize: 13,
    fontWeight: '500',
  },
  sportTypePills: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  sportPillDark: {
    borderColor: darkColors.border,
  },
  sportPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sportPillTextDark: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  listFooterContainer: {
    marginTop: spacing.md,
  },
  exportGpxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  exportGpxButtonDark: {
    backgroundColor: colors.primary,
  },
  exportGpxButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning + '15',
    borderWidth: 1,
    borderColor: colors.warning + '30',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  disabledBannerDark: {
    backgroundColor: colors.warning + '20',
    borderColor: colors.warning + '40',
  },
  disabledBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.warning,
  },
  mergeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.info + '10',
    borderWidth: 1,
    borderColor: colors.info + '25',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  mergeBannerDark: {
    backgroundColor: colors.info + '15',
    borderColor: colors.info + '30',
  },
  mergeBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.info,
  },
  mergeBannerTextDark: {
    color: colors.infoLight,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
});
