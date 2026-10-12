/**
 * The status bar and scroll state of a map-hero detail screen, both read from `mapHeroChrome`.
 *
 * The style is a status bar entry mounted only while the screen is focused. The stack keeps a
 * covered screen mounted and frozen, so an entry mounted for the screen's whole life would carry
 * its white glyphs onto whatever screen is pushed over it. The native stack's own per-screen
 * status bar option is not used: on iOS it needs view-controller-based status bar appearance,
 * which the app turns off so the root entry and the full-screen maps' entries apply.
 */

import React, { useCallback, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { heroScrolledPast, mapHeroChrome } from '@/shared/app/screenHeaders';
import { HERO_HEADER_HEIGHT } from '@/shared/ui/DetailHero';

export function MapHeroStatusBar({
  scrolledPastHero,
  isDark,
}: {
  scrolledPastHero: boolean;
  isDark: boolean;
}) {
  const focused = useIsFocused();
  if (!focused) return null;
  return <StatusBar style={mapHeroChrome({ scrolledPastHero, isDark }).statusBarStyle} animated />;
}

/**
 * Whether the hero at the top of a scroll view has scrolled out from under the header, and the
 * scroll handler that tracks it. The state changes only when that answer flips, so a scroll
 * renders the screen twice at most rather than once a frame.
 */
export function useHeroScrolledPast(heroHeight: number) {
  const headerBottom = useSafeAreaInsets().top + HERO_HEADER_HEIGHT;
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setScrolledPastHero(
        heroScrolledPast(event.nativeEvent.contentOffset.y, heroHeight, headerBottom)
      );
    },
    [heroHeight, headerBottom]
  );
  return { scrolledPastHero, onScroll };
}
