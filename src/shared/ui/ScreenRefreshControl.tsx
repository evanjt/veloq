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

import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useTheme } from '@/shared/app';
import { duration, themePalette } from '@/theme';
import { SyncState } from 'veloqrs';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { onPullRefresh } from './haptics';

export type ScreenRefreshControlProps = Omit<
  RefreshControlProps,
  'colors' | 'tintColor' | 'progressBackgroundColor' | 'title' | 'titleColor' | 'onRefresh'
> & {
  onRefresh: () => unknown;
};

export function ScreenRefreshControl({
  onRefresh,
  refreshing,
  ...rest
}: ScreenRefreshControlProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  // The control ignores what the handler returns, so a screen's promise is left to the screen.
  const [pull, setPull] = useState<'idle' | 'owed' | 'running'>('idle');
  const syncing = useSyncState() === SyncState.Syncing;

  // A pull owns the spinner from the gesture until the sync it asked for has
  // run and ended, so the spinner outlasts the request that started it.
  if (pull === 'owed' && syncing) setPull('running');
  else if (pull === 'running' && !syncing && !refreshing) setPull('idle');

  // A pull whose request ends before the engine announces a sync lets go after
  // a short wait rather than holding for ever.
  useEffect(() => {
    if (pull !== 'owed' || refreshing) return undefined;
    const timer = setTimeout(() => setPull('idle'), duration.hold);
    return () => clearTimeout(timer);
  }, [pull, refreshing]);

  const handleRefresh = useMemo(() => {
    const pulled = onPullRefresh(onRefresh);
    return () => {
      setPull('owed');
      void pulled();
    };
  }, [onRefresh]);

  return (
    <RefreshControl
      {...rest}
      refreshing={refreshing || pull !== 'idle'}
      onRefresh={handleRefresh}
      colors={[palette.actionLink]}
      tintColor={palette.actionLink}
      progressBackgroundColor={palette.surface}
    />
  );
}
