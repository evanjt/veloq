import { StyleSheet } from 'react-native';

import { colors, spacing, layout, typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 80,
  },
  timerText: {
    ...typography.statsHero,
  },
  timerPaused: {
    opacity: 0.45,
  },
  autoPauseLabel: {
    ...typography.caption,
    fontWeight: '500',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lockChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
    borderRadius: 4,
  },
  statusText: {
    ...typography.captionBold,
  },
  mainContent: {
    flex: 1,
    minHeight: 200,
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  indoorTimer: {
    ...typography.heroNumber,
    marginTop: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  // Manual entry styles
  manualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  manualBackBtn: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    textAlignVertical: 'center',
  },
  manualTitle: {
    ...typography.sectionTitle,
    marginLeft: spacing.xs,
  },
  manualForm: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  fieldLabel: {
    ...typography.caption,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  notesInput: {
    minHeight: 100,
  },
  buttonContainer: {
    marginTop: spacing.lg,
  },
  primaryButton: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: layout.minTapTarget,
  },
  primaryButtonText: {
    ...typography.bodyBold,
    color: colors.textOnDark,
  },
});
