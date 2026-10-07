/**
 * Scenario: icon-only and text-only controls drawn smaller than the platform
 * tap-target minimum.
 *
 * Expected behaviour: each control's drawn size, plus any hit slop, reaches
 * `layout.minTapTarget` on both axes.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { HeroNameRow } from '@/shared/ui/DetailHero';
import { FeedFilterChips, FEED_CHIP_HEIGHT } from '@/features/activity/components/FeedFilterChips';
import { TrackFetchNotice } from '@/shared/ui/TrackFetchNotice';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { layout } from '@/theme/layout';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

type Slop = number | { top?: number; bottom?: number; left?: number; right?: number } | undefined;

function slopOn(slop: Slop, side: 'top' | 'bottom' | 'left' | 'right'): number {
  if (typeof slop === 'number') return slop;
  return slop?.[side] ?? 0;
}

function reach(node: { props: { style?: unknown; hitSlop?: Slop } }) {
  const resolved =
    typeof node.props.style === 'function'
      ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : node.props.style;
  const style = StyleSheet.flatten(resolved as never) as Record<string, number | undefined>;
  const { hitSlop } = node.props;
  return {
    width:
      Math.max(style.width ?? 0, style.minWidth ?? 0) +
      slopOn(hitSlop, 'left') +
      slopOn(hitSlop, 'right'),
    height:
      Math.max(style.height ?? 0, style.minHeight ?? 0) +
      slopOn(hitSlop, 'top') +
      slopOn(hitSlop, 'bottom'),
  };
}

describe('tap-target floor', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('holds the rename save and cancel controls to the minimum', () => {
    render(
      <HeroNameRow
        name="Lake loop"
        editable={{
          isEditing: true,
          editName: 'Lake loop',
          inputRef: { current: null },
          placeholder: 'Name',
          testIDPrefix: 'route',
          onStartEdit: jest.fn(),
          onSave: jest.fn(),
          onCancel: jest.fn(),
          onChange: jest.fn(),
        }}
      />
    );

    for (const control of [
      screen.getByTestId('route-rename-save'),
      screen.getByLabelText('Cancel'),
    ]) {
      const { width, height } = reach(control);
      expect(width).toBeGreaterThanOrEqual(layout.minTapTarget);
      expect(height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('holds the track notice dismiss to the minimum height', () => {
    useTrackFetchNotice.setState({ failedIds: [], failedCount: 2, dismissed: false });
    render(<TrackFetchNotice />);

    expect(reach(screen.getByTestId('track-fetch-notice-dismiss')).height).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
  });

  it('holds the feed filter chips to the minimum height', () => {
    render(
      <FeedFilterChips
        selected={new Set()}
        onSelect={jest.fn()}
        selectedRange={null}
        onSelectRange={jest.fn()}
        isDark={false}
      />
    );

    const chip = screen.getByTestId('home-filter-cycling');
    expect(FEED_CHIP_HEIGHT + reach(chip).height).toBeGreaterThanOrEqual(layout.minTapTarget);
  });
});
