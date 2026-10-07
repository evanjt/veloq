/**
 * Scenario: a list shows skeletons while its read is pending and the rows replace them.
 * Expected behaviour: each skeleton occupies the same box as the row it stands in for, so the
 * swap moves nothing.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ActivityCardSkeleton } from '@/shared/ui/Shimmer';
import { RowSkeleton } from '@/features/routes/components/RowSkeleton';
import { spacing } from '@/theme';
import {
  ROW_MARGIN_BOTTOM,
  ROW_MARGIN_HORIZONTAL,
  ROW_PADDING,
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
} from '@/features/routes/lib/rowLayout';
import { CARD_HEIGHT, CARD_MARGIN } from '@/features/activity/lib/cardLayout';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

describe('skeleton sizes', () => {
  it('the activity card skeleton has the card height and margins', () => {
    render(<ActivityCardSkeleton />);
    const outer = StyleSheet.flatten(screen.getByTestId('activity-card-skeleton').props.style);
    const shimmer = StyleSheet.flatten(
      screen.getByTestId('activity-card-skeleton-fill').props.style
    );
    expect(outer.marginHorizontal).toBe(CARD_MARGIN);
    expect(outer.marginBottom).toBe(CARD_MARGIN);
    expect(shimmer.height).toBe(CARD_HEIGHT);
    expect(CARD_MARGIN).toBe(spacing.smPlus);
    expect(CARD_HEIGHT).toBe(240);
  });

  it('the row skeleton has the row padding, margins and preview size', () => {
    render(<RowSkeleton />);
    const outer = StyleSheet.flatten(screen.getByTestId('row-skeleton').props.style);
    expect(outer.padding).toBe(ROW_PADDING);
    expect(outer.marginHorizontal).toBe(ROW_MARGIN_HORIZONTAL);
    expect(outer.marginBottom).toBe(ROW_MARGIN_BOTTOM);
    const preview = StyleSheet.flatten(screen.getByTestId('row-skeleton-preview').props.style);
    expect(preview.width).toBe(ROW_PREVIEW_WIDTH);
    expect(preview.height).toBe(ROW_PREVIEW_HEIGHT);
  });
});
