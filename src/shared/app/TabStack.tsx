/**
 * The stack a headered tab root sits in.
 *
 * The tab group draws no chrome of its own, so this is what gives a tab root the platform's
 * header: titled from `TAB_HEADERS`, a large title on iOS where the entry takes one, and the
 * trailing items and search field the screen hands its stack through `Stack.Screen`. The title
 * is the platform's own, so both screen readers announce it as a heading. The root reports the
 * header's height while it is in front, so the pills floating at the top sit below the header.
 */

import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useHeaderHeight, useIsFocused } from 'expo-router/react-navigation';
import { useTranslation } from 'react-i18next';

import { useTheme } from './useTheme';
import { useShownHeaderHeights } from './topBanner';
import {
  TAB_HEADERS,
  headerTitleOf,
  largeTitleScreenOptions,
  themeHeaderColors,
} from './screenHeaders';

function ReportsHeaderHeight({
  routeKey,
  children,
}: {
  routeKey: string;
  children: React.ReactElement;
}) {
  const height = useHeaderHeight();
  const focused = useIsFocused();
  const setHeight = useShownHeaderHeights((s) => s.setHeight);
  useEffect(() => {
    setHeight(routeKey, focused && height > 0 ? height : null);
  }, [routeKey, focused, height, setHeight]);
  useEffect(() => () => setHeight(routeKey, null), [routeKey, setHeight]);
  return children;
}

function reportsHeaderLayout({
  route,
  children,
}: {
  route: { key: string };
  children: React.ReactElement;
}): React.ReactElement {
  return <ReportsHeaderHeight routeKey={route.key}>{children}</ReportsHeaderHeight>;
}

export function TabStack({ tab }: { tab: string }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  return (
    <Stack screenOptions={themeHeaderColors(isDark)} screenLayout={reportsHeaderLayout}>
      <Stack.Screen
        name="index"
        options={{
          title: headerTitleOf(TAB_HEADERS[tab], t),
          ...largeTitleScreenOptions(tab, Platform.OS, TAB_HEADERS),
        }}
      />
    </Stack>
  );
}
