/**
 * The status bar of a map-hero detail screen, read from `mapHeroChrome`.
 *
 * The style is a status bar entry mounted only while the screen is focused. The stack keeps a
 * covered screen mounted and frozen, so an entry mounted for the screen's whole life would carry
 * its white glyphs onto whatever screen is pushed over it. The native stack's own per-screen
 * status bar option is not used: on iOS it needs view-controller-based status bar appearance,
 * which the app turns off so the root entry and the full-screen maps' entries apply.
 */

import React from 'react';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { mapHeroChrome } from '@/shared/app/screenHeaders';

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
