import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';

export const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  readFailure: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
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
