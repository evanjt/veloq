import { StyleSheet } from 'react-native';

import { layout, spacing, typography } from '@/theme';

/** Geometry shared by the routes and sections rows and the skeletons that stand in for them. */
export const ROW_PREVIEW_WIDTH = 48;
export const ROW_PREVIEW_HEIGHT = 36;
export const ROW_MARGIN_HORIZONTAL = spacing.md;
export const ROW_MARGIN_BOTTOM = spacing.xxs;

/**
 * The containers a routes or sections row stands in, and its skeleton with it.
 * The meta line is in the caption role whatever it holds, so a row stands as
 * tall with a proximity tag as without one.
 */
export const rowContainers = StyleSheet.create({
  wrapper: {
    marginHorizontal: ROW_MARGIN_HORIZONTAL,
    marginBottom: ROW_MARGIN_BOTTOM,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewBox: {
    width: ROW_PREVIEW_WIDTH,
    height: ROW_PREVIEW_HEIGHT,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    ...typography.bodyCompactBold,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xxs,
    gap: spacing.sm,
  },
  metaText: {
    ...typography.caption,
  },
});
