import { StyleSheet } from 'react-native';

import { spacing, layout, typography, stroke } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  /** Waiting for an answer the screen cannot act without. */
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: stroke.hairline,
  },
  typeBadgeText: {
    ...typography.captionBold,
    maxWidth: 80,
  },
  timerText: {
    ...typography.statsHero,
  },
  autoPauseLabel: {
    ...typography.captionBold,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lockChip: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  statusText: {
    ...typography.captionBold,
  },
  /** Everything above the bottom slot: shrinks, then scrolls, so the slot never leaves the window. */
  columnRegion: {
    flex: 1,
  },
  columnContent: {
    flexGrow: 1,
  },
  /** Fills the region until it is measured, then takes the height the layout gives it. */
  mainContent: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  indoorDisplay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: stroke.hairline,
  },
  indoorTimer: {
    ...typography.heroNumber,
    marginTop: spacing.md,
  },
  // Manual entry styles
  manualForm: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  field: {
    marginTop: spacing.md,
  },
  buttonContainer: {
    marginTop: spacing.lg,
  },
});
