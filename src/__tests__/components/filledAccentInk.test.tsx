/**
 * Scenario: the sync banner, the unlock handle and the map control column each
 * draw content on a filled teal ground. White measures 2.28:1 to 3.74:1 on those
 * fills, under the 4.5:1 text and the 3:1 icons owe, while
 * `colors.textOnPrimary` is the ink they can carry. The recording control bar's
 * main button takes the record red in every state and theme, and its Stop and
 * Lap stay secondary.
 *
 * Expected behaviour: every text and glyph on such a fill reaches 4.5:1
 * against it, drawn at full opacity.
 */
import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { SyncProgressBanner } from '@/features/maps/components/timeline/SyncProgressBanner';
import { ControlBar } from '@/features/recording/components/ControlBar';
import { UnlockTrack } from '@/features/recording/components/UnlockTrack';
import { MapControlStack } from '@/features/maps/components/regional/MapControlStack';
import { brand, colors, darkColors, recording } from '@/theme';
import { contrastRatio } from '../__shared__/contrast';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

afterEach(() => {
  mockIsDark = false;
});

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (state: unknown) => unknown) =>
    selector({
      gpsSyncProgress: { status: 'fetching', current: 4, total: 10 },
      isGpsSyncing: true,
      extendedFetch: { running: true },
    }),
}));
jest.mock('@/shared/app/extendedFetch', () => ({ isExtendedFetchRunning: () => false }));
jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => ({ upstream: 100, fetched: 40, tracksUpstream: 80, tracksStored: 20 }),
}));

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/** Every colour drawn inside `root`, text and glyph alike. */
function inksWithin(root: ReactTestInstance): string[] {
  const texts = root.findAllByType(Text).map((n) => flat(n.props.style).color as string);
  const glyphs = root.findAllByType(MaterialCommunityIcons).map((n) => n.props.color as string);
  return [...texts, ...glyphs].filter(Boolean);
}

describe('the sync progress banner', () => {
  it('draws every line and its icon in an ink the teal can carry', async () => {
    const { getByTestId } = await render(<SyncProgressBanner />);
    const banner = getByTestId('sync-progress-banner');
    const fill = flat(banner.props.style).backgroundColor as string;
    const inks = inksWithin(banner);

    expect(fill).toBe(colors.primary);
    // The headline, the count, two library lines and the icon.
    expect(inks.length).toBeGreaterThanOrEqual(4);
    for (const ink of inks) {
      expect(ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the recording control bar', () => {
  const bar = {
    mode: 'gps' as never,
    onLap: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onStart: jest.fn(),
    onStop: jest.fn(),
    onReview: jest.fn(),
  };

  const primaries = [
    ['idle', 'gps', 'control-start'],
    ['paused', 'gps', 'control-resume'],
    ['recording', 'gps', 'control-pause'],
    ['stopped', 'gps', 'control-review'],
    ['idle', 'manual', 'control-save'],
  ] as const;
  const themes = [false, true] as const;
  const notRecordFills = [
    colors.success,
    darkColors.success,
    brand.teal,
    brand.tealLight,
    brand.tealDark,
  ].map((c) => c.toUpperCase());

  describe.each(themes)('with dark %s', (isDark) => {
    beforeEach(() => {
      mockIsDark = isDark;
    });

    it.each(primaries)(
      'fills the %s %s main button with the record red and a glyph it carries',
      async (status, mode, testID) => {
        const { getByTestId } = await render(
          <ControlBar {...bar} mode={mode as never} status={status} />
        );
        const button = getByTestId(testID);
        const fill = flat(button.props.style).backgroundColor as string;
        const [glyph] = button.findAllByType(MaterialCommunityIcons);

        expect(fill).toBe(isDark ? recording.dark : recording.light);
        expect(notRecordFills).not.toContain(fill.toUpperCase());
        expect(contrastRatio(glyph.props.color, fill)).toBeGreaterThanOrEqual(4.5);
      }
    );

    it('keeps Stop in the red text tone and Lap in the primary text tone', async () => {
      const { getByTestId } = await render(<ControlBar {...bar} status="recording" />);
      const palette = isDark ? darkColors : colors;
      const [stopGlyph] = getByTestId('control-stop').findAllByType(MaterialCommunityIcons);
      const [lapGlyph] = getByTestId('control-lap').findAllByType(MaterialCommunityIcons);

      expect(stopGlyph.props.color).toBe(palette.errorDeep);
      expect(lapGlyph.props.color).toBe(palette.textPrimary);
    });
  });
});

describe('the slide to unlock handle', () => {
  it('draws its lock glyph in an ink the teal can carry', async () => {
    const { getByTestId } = await render(<UnlockTrack onUnlock={() => {}} />);
    const handle = getByTestId('unlock-track-handle');
    const fill = flat(handle.props.style).backgroundColor as string;
    const [glyph] = handle.findAllByType(MaterialCommunityIcons);

    expect(contrastRatio(glyph.props.color, fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the map control column', () => {
  it.each([false, true])(
    'draws an active glyph in the ink the teal can carry (dark %s)',
    async (isDark) => {
      const { getByTestId } = await render(
        <MapControlStack
          top={100}
          isDark={isDark}
          is3DMode
          can3D
          showActivities
          showHeatmap={false}
          showSections
          showRoutes={false}
          userLocationActive
          locationLoading={false}
          sectionCount={3}
          routeCount={2}
          activityCount={10}
          bearingAnim={new Animated.Value(0)}
          onToggle3D={jest.fn()}
          onResetOrientation={jest.fn()}
          onGetLocation={jest.fn()}
          onToggleActivities={jest.fn()}
          onToggleHeatmap={jest.fn()}
          onToggleSections={jest.fn()}
          onToggleRoutes={jest.fn()}
          onFitAll={jest.fn()}
        />
      );
      for (const testID of ['map-toggle-3d', 'map-location']) {
        const button = getByTestId(testID);
        const fill = flat(button.props.style).backgroundColor as string;
        const [glyph] = button.findAllByType(MaterialCommunityIcons);

        expect(fill).toBe(colors.primary);
        expect(contrastRatio(glyph.props.color, fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  );
});
