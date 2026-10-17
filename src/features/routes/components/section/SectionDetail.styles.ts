import { StyleSheet } from 'react-native';
import { colors, darkColors, spacing, typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  readFailure: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  rescanRefusal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  rescanRefusalText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rescanRefusalTextDark: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
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
