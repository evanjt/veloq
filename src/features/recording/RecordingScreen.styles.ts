import { StyleSheet } from 'react-native';

import { spacing, layout, typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hrZoneBar: {
    height: 4,
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
    ...typography.heroNumber,
    fontVariant: ['tabular-nums'],
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
  sensorChipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
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
  // Auto-pause banner
  autoPauseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
  },
  autoPauseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9CA3AF',
  },
  autoPauseText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  // Km split banner
  splitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(34, 197, 94, 0.85)',
  },
  splitBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
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
    color: '#FFFFFF',
  },
  relockButton: {
    position: 'absolute',
    right: spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  gpsWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  gpsWarningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#F59E0B',
  },
});
