import { StyleSheet } from 'react-native';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
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
});
