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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rescanRefusal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  rescanRefusalText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  rescanRefusalTextDark: {
    color: darkColors.textSecondary,
  },
  actionChips: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  actionPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
    borderRadius: layout.borderRadius,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  actionPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
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
  // What is left after the shared `Button` took the ground, the shape, the
  // type and the press: where this one sits on the screen, and nothing else.
  exportGpxButton: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
    gap: spacing.md,
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
  },
  disabledBannerDark: {
    backgroundColor: colors.warning + '20',
    borderColor: colors.warning + '40',
  },
  // The colour is the consumer's: amber has to be the deep tone on white and
  // the light tone on near-black, and a stylesheet cannot read the theme.
  disabledBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
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
  },
  mergeBannerDark: {
    backgroundColor: colors.info + '15',
    borderColor: colors.info + '30',
  },
  mergeBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.infoText,
  },
  mergeBannerTextDark: {
    color: darkColors.infoText,
  },
});
