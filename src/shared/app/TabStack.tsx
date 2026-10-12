/**
 * The stack a headered tab root sits in.
 *
 * The tab group draws no chrome of its own, so this is what gives a tab root the platform's
 * header: titled from `TAB_HEADERS`, a large title on iOS where the entry takes one, and the
 * trailing items and search field the screen hands its stack through `Stack.Screen`. The title
 * is the platform's own, so both screen readers announce it as a heading.
 */

import React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from './useTheme';
import {
  TAB_HEADERS,
  headerTitleOf,
  largeTitleScreenOptions,
  themeHeaderColors,
} from './screenHeaders';

export function TabStack({ tab }: { tab: string }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  return (
    <Stack screenOptions={themeHeaderColors(isDark)}>
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
