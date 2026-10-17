/**
 * Scenario: About drew a generic glyph on a tint where the app icon belongs,
 * and hand-built its own copy of the data attribution block that Data Sources
 * also built, so the two drifted apart.
 *
 * Expected behaviour: About shows the app icon asset itself, and both screens
 * mount the one attribution component.
 */

import React from 'react';
import { Image } from 'react-native';
import { render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import AboutScreen from '@/app/about';
import DataSourcesSettingsScreen from '@/app/data-sources-settings';
import { DataAttribution } from '@/features/settings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

const appIcon = require('../../assets/icon.png');

describe('the About header', () => {
  it('shows the app icon asset rather than a glyph', async () => {
    const screen = await render(<AboutScreen />);
    const glyphs = screen.UNSAFE_queryAllByType(MaterialCommunityIcons);
    expect(glyphs.filter((g) => g.props.name === 'bike-fast')).toHaveLength(0);
    const images = screen.UNSAFE_queryAllByType(Image);
    expect(images.some((i) => i.props.source === appIcon)).toBe(true);
  });
});

describe('the data attribution block', () => {
  it('is the one component on About', async () => {
    const screen = await render(<AboutScreen />);
    expect(screen.UNSAFE_queryAllByType(DataAttribution)).toHaveLength(1);
  });

  it('is the one component on Data Sources', async () => {
    const screen = await render(<DataSourcesSettingsScreen />);
    expect(screen.UNSAFE_queryAllByType(DataAttribution)).toHaveLength(1);
  });
});
