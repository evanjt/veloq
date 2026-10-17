/**
 * The pull-to-refresh control every scrolling screen passes as its
 * `refreshControl`, so the gesture looks and feels the same everywhere.
 *
 * It is the platform's own control, tinted with the action link colour of the
 * active theme. Android reads `colors` for the arc and draws it on
 * `progressBackgroundColor`, which otherwise stays a light disc in the dark
 * theme; iOS reads `tintColor` and carries no label. The pull fires the medium
 * haptic once as it commits, so a screen passes its handler unwrapped.
 *
 * A scroll view clones this element and renders itself as its child, so every
 * other prop is passed through to `RefreshControl`.
 */

import React, { useMemo } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useTheme } from '@/shared/app';
import { themePalette } from '@/theme';
import { onPullRefresh } from './haptics';

export type ScreenRefreshControlProps = Omit<
  RefreshControlProps,
  'colors' | 'tintColor' | 'progressBackgroundColor' | 'title' | 'titleColor' | 'onRefresh'
> & {
  onRefresh: () => unknown;
};

export function ScreenRefreshControl({ onRefresh, ...rest }: ScreenRefreshControlProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  // The control ignores what the handler returns, so a screen's promise is left to the screen.
  const handleRefresh = useMemo(() => {
    const pull = onPullRefresh(onRefresh);
    return () => {
      void pull();
    };
  }, [onRefresh]);
  return (
    <RefreshControl
      {...rest}
      onRefresh={handleRefresh}
      colors={[palette.actionLink]}
      tintColor={palette.actionLink}
      progressBackgroundColor={palette.surface}
    />
  );
}
