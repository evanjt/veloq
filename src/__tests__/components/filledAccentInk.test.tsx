/**
 * Scenario: the sync banner and the unlock handle draw content on a filled
 * ground, and a map column control that is on fills the control on blue. An
 * ink chosen for another ground falls under the 4.5:1 text and the 3:1 icons
 * owe. The recording control bar's main button takes the record red for Start
 * and Resume and the action blue for Pause, Review and the manual Save, and its
 * Lap and Finish stay neutral side controls.
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
import { colors, darkColors, recording, themePalette } from '@/theme';
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
      extendedFetch: { running: true },
    }),
}));
jest.mock('@/shared/native/useSyncStatus', () => ({
  useTrackStage: () => ({
    step: require('../__shared__/veloqrsStub').TrackStep.Downloading,
    completed: 4,
    total: 10,
    percent: 40,
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

    expect(fill).toBe(colors.actionPrimary);
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
    ['idle', 'gps', 'control-start', 'record'],
    ['paused', 'gps', 'control-resume', 'record'],
    ['recording', 'gps', 'control-pause', 'action'],
    ['stopped', 'gps', 'control-review', 'action'],
    ['idle', 'manual', 'control-save', 'action'],
  ] as const;
  const themes = [false, true] as const;
  // A status fill with a label, never a button.
  const neverFills = [colors.successFill, darkColors.successFill].map((c) => c.toUpperCase());

  describe.each(themes)('with dark %s', (isDark) => {
    beforeEach(() => {
      mockIsDark = isDark;
    });

    it.each(primaries)(
      'fills the %s %s main button with its role and a glyph it carries',
      async (status, mode, testID, role) => {
        const { getByTestId } = await render(
          <ControlBar {...bar} mode={mode as never} status={status} />
        );
        const button = getByTestId(testID);
        const fill = flat(button.props.style).backgroundColor as string;
        const [glyph] = button.findAllByType(MaterialCommunityIcons);
        const expected =
          role === 'record'
            ? isDark
              ? recording.dark
              : recording.light
            : themePalette(isDark).actionPrimary;

        expect(fill).toBe(expected);
        expect(neverFills).not.toContain(fill.toUpperCase());
        expect(contrastRatio(glyph.props.color, fill)).toBeGreaterThanOrEqual(4.5);
      }
    );

    it.each(['recording', 'paused'] as const)(
      'draws Finish and Lap as neutral side controls on the raised ground with an edge (%s)',
      async (status) => {
        const { getByTestId, queryByTestId, getByText } = await render(
          <ControlBar {...bar} status={status} />
        );
        const palette = themePalette(isDark);
        const sides = ['control-stop', ...(status === 'recording' ? ['control-lap'] : [])];
        if (status === 'paused') expect(queryByTestId('control-lap')).toBeNull();

        for (const testID of sides) {
          const button = getByTestId(testID);
          const style = flat(button.props.style);
          const [glyph] = button.findAllByType(MaterialCommunityIcons);

          expect(style.backgroundColor).toBe(palette.surfaceRaised);
          expect(style.borderColor).toBe(palette.controlBoundary);
          expect(style.borderWidth).toBeGreaterThan(0);
          expect(glyph.props.color).toBe(palette.textPrimary);
          expect(contrastRatio(glyph.props.color, palette.surfaceRaised)).toBeGreaterThanOrEqual(
            4.5
          );
        }
        expect(getByTestId('control-stop').props.accessibilityLabel).toBe(
          'recording.controls.finish'
        );
        expect(getByText('recording.controls.finish')).toBeTruthy();
      }
    );
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
    'draws an on control on the control on blue under an ink it carries (dark %s)',
    async (isDark) => {
      mockIsDark = isDark;
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

        expect(fill).toBe(themePalette(isDark).controlOn);
        expect(button.props.accessibilityState).toMatchObject({ selected: true });
        expect(contrastRatio(glyph.props.color, fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  );
});
