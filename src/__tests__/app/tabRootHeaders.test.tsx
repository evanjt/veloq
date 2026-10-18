/**
 * Scenario: the tab group took no header, so each tab root drew its title as plain 18 pt text in
 * a row of its own, which a screen reader reads as body text, while the forms two levels down
 * took the platform's large title.
 *
 * Expected behaviour: every tab but the map is a stack of one screen whose native header carries
 * the title, which the platform presents as a heading, and the map stays full-bleed.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { TAB_HEADERS, headerLargeTitle } from '@/shared/app/screenHeaders';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const TABS_DIR = path.resolve(__dirname, '../../app/(tabs)');

const HEADERED: [string, string][] = [
  ['(feed)', 'navigation.feed'],
  ['fitness', 'navigation.fitness'],
  ['insights', 'insights.title'],
  ['settings', 'settings.title'],
];

describe('tab root headers', () => {
  it.each(HEADERED)('titles the %s tab in its native header, as a heading', async (tab, key) => {
    const layout = path.join(TABS_DIR, tab, '_layout.tsx');
    expect(fs.existsSync(layout)).toBe(true);
    const Layout = require(layout).default as React.ComponentType;
    await render(<Layout />);
    expect(screen.getByRole('header', { name: key })).toBeTruthy();
  });

  it('declares a header entry for every tab the tab group registers', () => {
    const tabs = fs
      .readdirSync(TABS_DIR, { withFileTypes: true })
      .map((entry) => entry.name.replace(/\.tsx$/, ''))
      .filter((name) => name !== '_layout')
      .sort();
    expect(Object.keys(TAB_HEADERS ?? {}).sort()).toEqual(tabs);
  });

  it('leaves the map tab without a header, full-bleed under its own controls', () => {
    expect(TAB_HEADERS?.map).toBeNull();
    expect(fs.existsSync(path.join(TABS_DIR, 'map', '_layout.tsx'))).toBe(false);
  });

  it('collapses a large title on iOS only where the scroll view is the first child', () => {
    const large = Object.keys(TAB_HEADERS ?? {})
      .filter((tab) => headerLargeTitle(tab, 'ios', TAB_HEADERS))
      .sort();
    expect(large).toEqual(['fitness', 'settings']);
    for (const tab of Object.keys(TAB_HEADERS ?? {})) {
      expect(headerLargeTitle(tab, 'android', TAB_HEADERS)).toBe(false);
    }
  });
});
