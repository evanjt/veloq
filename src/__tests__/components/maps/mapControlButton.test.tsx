/**
 * Scenario: a round button floats over a map, on the activity hero, the section page, the Map tab
 * and the recording map, in either theme and either state.
 *
 * Expected behaviour: it is drawn as a 40 px disc on the raised surface with the map-overlay
 * shadow, keeping that shadow in dark mode and adding the card edge there, and its hit area reaches
 * the platform tap minimum through slop. A toggle that is on fills the control-on blue under the
 * on-fill glyph and tells a screen reader it is selected, and every map draws that state alike.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MapControlButton } from '@/features/maps/components/MapControlButton';
import { ActivityMapControls } from '@/features/maps/components/ActivityMapControls';
import { MapControlStack } from '@/features/maps/components/regional/MapControlStack';
import { colors, controlHeight, darkColors, layout, raised, shadows } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

const METRICS = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

function flat(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as never) ?? {};
}

function glyphColour(testID: string): string {
  const [glyph] = screen.getByTestId(testID).findAllByType(MaterialCommunityIcons);
  return glyph.props.color as string;
}

async function renderButton(props: Partial<React.ComponentProps<typeof MapControlButton>> = {}) {
  await render(
    <MapControlButton testID="probe" accessibilityLabel="Locate" onPress={jest.fn()} {...props}>
      <MapControlButton.Glyph name="crosshairs-gps" />
    </MapControlButton>
  );
  return screen.getByTestId('probe');
}

afterEach(() => {
  mockIsDark = false;
});

describe('MapControlButton', () => {
  it('draws a 40 px disc and lifts its hit area to the tap minimum through slop', async () => {
    const node = await renderButton();
    const style = flat(node);

    expect(style.width).toBe(controlHeight.button);
    expect(style.height).toBe(controlHeight.button);
    expect(style.borderRadius).toBe(layout.borderRadiusFull);
    const slop = node.props.hitSlop;
    expect(controlHeight.button + slop.top + slop.bottom).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
    expect(controlHeight.button + slop.left + slop.right).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
  });

  it('sits on the raised surface with the map-overlay shadow in light', async () => {
    const style = flat(await renderButton());

    expect(style.backgroundColor).toBe(colors.surfaceRaised);
    expect(style).toMatchObject(shadows.mapOverlay);
  });

  it('keeps the map-overlay shadow in dark and adds the card edge', async () => {
    mockIsDark = true;
    const style = flat(await renderButton());

    expect(style.backgroundColor).toBe(darkColors.surfaceRaised);
    expect(style).toMatchObject(shadows.mapOverlay);
    expect(style).toMatchObject(raised('mapOverlay', true));
  });

  it('carries its label to a screen reader', async () => {
    const node = await renderButton();

    expect(node.props.accessibilityLabel).toBe('Locate');
    expect(node.props.accessibilityRole).toBe('button');
  });

  it.each([false, true])(
    'fills control-on under the on-fill glyph when selected (dark %s)',
    async (isDark) => {
      mockIsDark = isDark;
      const node = await renderButton({ selected: true });

      expect(node.props.accessibilityState).toMatchObject({ selected: true });
      expect(flat(node).backgroundColor).toBe((isDark ? darkColors : colors).controlOn);
      expect(glyphColour('probe')).toBe(colors.textOnFill);
    }
  );

  it('reports an unselected toggle as not selected, on the raised surface', async () => {
    const node = await renderButton({ selected: false });

    expect(node.props.accessibilityState).toMatchObject({ selected: false });
    expect(flat(node).backgroundColor).toBe(colors.surfaceRaised);
    expect(glyphColour('probe')).toBe(colors.iconSecondary);
  });
});

describe('the map control columns draw one button', () => {
  it('reports 3D and location on to a screen reader in the Map tab column, in the activity map ink', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <MapControlStack
          top={100}
          isDark={false}
          is3DMode
          can3D
          showActivities
          showHeatmap={false}
          showSections={false}
          showRoutes={false}
          userLocationActive
          locationLoading={false}
          sectionCount={0}
          routeCount={0}
          activityCount={0}
          bearingAnim={new Animated.Value(0)}
          onToggle3D={jest.fn()}
          onResetOrientation={jest.fn()}
          onGetLocation={jest.fn()}
          onToggleActivities={jest.fn()}
          onFitAll={jest.fn()}
        />
        <ActivityMapControls
          mapStyle="light"
          onToggleStyle={jest.fn()}
          hasGradientData={false}
          gradientActive={false}
          onToggleGradient={jest.fn()}
          is3DMode
          is3DLoading={false}
          hasRoute
          onToggle3D={jest.fn()}
          bearingAnim={new Animated.Value(0)}
          onResetOrientation={jest.fn()}
          locationLoading={false}
          userLocationActive
          onGetLocation={jest.fn()}
          enableFullscreen={false}
          onOpenFullscreen={jest.fn()}
          mapHeight={400}
        />
      </SafeAreaProvider>
    );

    for (const id of ['map-toggle-3d', 'map-location']) {
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ selected: true });
      expect(glyphColour(id)).toBe(glyphColour('activity-map-location'));
    }
    for (const id of ['map-toggle-3d', 'activity-map-3d-toggle', 'activity-map-style-toggle']) {
      const style = flat(screen.getByTestId(id));
      expect(style.width).toBe(controlHeight.button);
      expect(style.height).toBe(controlHeight.button);
      expect(style).toMatchObject(shadows.mapOverlay);
    }
  });
});
