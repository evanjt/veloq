/**
 * Scenario: the activity hero's map starts at y = 0 and runs under the status bar, and the
 * transparent native header is drawn over it and takes the touches there. On Android that bar is
 * 56 dp below the inset, so a column placed from a guessed row height puts the top of the first
 * button under the bar, where a tap does nothing.
 *
 * Expected behaviour: the column starts at or below the header's measured bottom edge. A hero too
 * short for every button wraps the rest into a second column, and the column is drawn wide enough
 * to hold it, or the full screen button is laid out past the map's edge.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { render, fireEvent, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeaderHeightContext } from 'expo-router/react-navigation';

import { ActivityMapControls } from '@/features/maps/components/ActivityMapControls';
import { mapPalette } from '@/theme';
import { MAP_CONTROL_GAP, MAP_CONTROL_SIZE } from '@/features/maps/components/MapControlButton';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const INSET_TOP = 24;
const ANDROID_TOOLBAR_HEIGHT = 56;
const HEADER_BOTTOM = INSET_TOP + ANDROID_TOOLBAR_HEIGHT;
const METRICS = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: INSET_TOP, left: 0, right: 0, bottom: 0 },
};

function renderControls(handlers: Partial<React.ComponentProps<typeof ActivityMapControls>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <HeaderHeightContext.Provider value={HEADER_BOTTOM}>
        <ActivityMapControls
          nextStyle="satellite"
          onToggleStyle={jest.fn()}
          hasGradientData={true}
          gradientActive={false}
          onToggleGradient={jest.fn()}
          is3DMode={false}
          is3DLoading={false}
          hasRoute={true}
          onToggle3D={jest.fn()}
          bearingAnim={new Animated.Value(0)}
          onResetOrientation={jest.fn()}
          locationLoading={false}
          userLocationActive={false}
          onGetLocation={jest.fn()}
          enableFullscreen={true}
          onOpenFullscreen={jest.fn()}
          mapHeight={400}
          isDark={false}
          basePalette={mapPalette('light')}
          {...handlers}
        />
      </HeaderHeightContext.Provider>
    </SafeAreaProvider>
  );
}

describe('the activity map control column', () => {
  it('starts below the measured header, not a guessed row height', async () => {
    await renderControls();

    const column = screen.getByTestId('activity-map-controls');
    const top = StyleSheet.flatten(column.props.style).top;
    expect(top).toBeGreaterThanOrEqual(HEADER_BOTTOM);
  });

  it('is as wide as every column it wraps into, so no button is laid out off the map', async () => {
    await renderControls({ mapHeight: HEADER_BOTTOM + 200 });

    const style = StyleSheet.flatten(screen.getByTestId('activity-map-controls').props.style);
    const step = MAP_CONTROL_SIZE + MAP_CONTROL_GAP;
    const perColumn = Math.floor((style.maxHeight + MAP_CONTROL_GAP) / step);
    expect(perColumn).toBeLessThan(6);
    const columns = Math.ceil(6 / perColumn);
    expect(style.width).toBe(columns * step - MAP_CONTROL_GAP);
  });

  it('holds one column when every button fits', async () => {
    await renderControls({ mapHeight: 2000 });

    const style = StyleSheet.flatten(screen.getByTestId('activity-map-controls').props.style);
    expect(style.width).toBe(MAP_CONTROL_SIZE);
  });

  it('replaces the gradient button with a layers button whose menu holds the gradient row', async () => {
    const onToggleGradient = jest.fn();
    await renderControls({ onToggleGradient });

    expect(screen.queryByTestId('activity-map-gradient-toggle')).toBeNull();
    expect(screen.queryByTestId('activity-map-layers-menu')).toBeNull();

    await fireEvent.press(screen.getByTestId('activity-map-layers'));
    expect(screen.getByTestId('activity-map-layers-menu')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('activity-map-layer-gradient'));
    expect(onToggleGradient).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('activity-map-layers-menu')).toBeNull();
  });

  it('shows the gradient key under the row while the colouring is on', async () => {
    await renderControls({ gradientActive: true });

    await fireEvent.press(screen.getByTestId('activity-map-layers'));
    expect(
      within(screen.getByTestId('activity-map-layer-gradient')).getAllByTestId('map-key-ramp-step')
    ).toHaveLength(7);
  });

  it('draws no layers button without gradient data, and keeps 3D, compass and locate as buttons', async () => {
    await renderControls({ hasGradientData: false });

    expect(screen.queryByTestId('activity-map-layers')).toBeNull();
    expect(screen.getByTestId('activity-map-3d-toggle')).toBeTruthy();
    expect(screen.getByLabelText('maps.resetOrientation')).toBeTruthy();
    expect(screen.getByTestId('activity-map-location')).toBeTruthy();
  });

  it('closes the menu from its scrim', async () => {
    await renderControls();

    await fireEvent.press(screen.getByTestId('activity-map-layers'));
    await fireEvent.press(screen.getByTestId('activity-map-layers-backdrop'));
    expect(screen.queryByTestId('activity-map-layers-menu')).toBeNull();
  });

  it.each([
    ['activity-map-style-toggle', 'onToggleStyle'],
    ['activity-map-3d-toggle', 'onToggle3D'],
    ['maps.resetOrientation', 'onResetOrientation'],
    ['activity-map-fullscreen', 'onOpenFullscreen'],
  ] as const)('activates %s on release', async (control, handlerName) => {
    const handler = jest.fn();
    await renderControls({ [handlerName]: handler });

    const button =
      control === 'maps.resetOrientation'
        ? screen.getByLabelText(control)
        : screen.getByTestId(control);
    await fireEvent(button, 'pressIn');
    expect(handler).not.toHaveBeenCalled();

    await fireEvent.press(button);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
