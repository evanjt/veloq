/**
 * Scenario: the Map tab's control column over a library with activities,
 * sections, routes and the heatmap all available.
 *
 * Expected behaviour: the column holds only 3D, the compass, locate and one
 * layers control, each drawn at the icon-button size and lifted to the
 * platform tap minimum by hit slop. The layer toggles and fit-all live in the
 * menu the layers control opens.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { MapControlStack } from '@/features/maps/components/regional/MapControlStack';
import { controlHeight, layout } from '@/theme';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const LAYER_IDS = [
  'map-toggle-activities',
  'map-toggle-sections',
  'map-toggle-heatmap',
  'map-toggle-routes',
  'map-fit-all',
];

function renderStack(props: Partial<React.ComponentProps<typeof MapControlStack>> = {}) {
  const handlers = {
    onToggle3D: jest.fn(),
    onResetOrientation: jest.fn(),
    onGetLocation: jest.fn(),
    onToggleActivities: jest.fn(),
    onToggleHeatmap: jest.fn(),
    onToggleSections: jest.fn(),
    onToggleRoutes: jest.fn(),
    onFitAll: jest.fn(),
  };
  render(
    <MapControlStack
      top={100}
      isDark={false}
      is3DMode={false}
      can3D
      showActivities
      showHeatmap={false}
      showSections
      showRoutes={false}
      userLocationActive={false}
      locationLoading={false}
      sectionCount={3}
      routeCount={2}
      activityCount={10}
      bearingAnim={new Animated.Value(0)}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('MapControlStack', () => {
  it('keeps the layer toggles and fit-all out of the column until the layers menu opens', () => {
    renderStack();

    for (const id of ['map-toggle-3d', 'map-compass', 'map-location', 'map-layers']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    for (const id of LAYER_IDS) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByTestId('map-layers').props.accessibilityState).toMatchObject({
      expanded: false,
    });
  });

  it('draws each column control at the icon-button size and reaches the tap minimum by slop', () => {
    renderStack();

    for (const id of ['map-toggle-3d', 'map-compass', 'map-location', 'map-layers']) {
      const node = screen.getByTestId(id);
      const style = StyleSheet.flatten(node.props.style);
      expect(style.width ?? style.minWidth).toBe(controlHeight.button);
      expect(style.height ?? style.minHeight).toBe(controlHeight.button);
      const slop = node.props.hitSlop;
      expect(controlHeight.button + slop.top + slop.bottom).toBeGreaterThanOrEqual(
        layout.minTapTarget
      );
      expect(controlHeight.button + slop.left + slop.right).toBeGreaterThanOrEqual(
        layout.minTapTarget
      );
    }
  });

  it('opens a menu with every available layer, its state, and fit-all', () => {
    const handlers = renderStack();

    fireEvent.press(screen.getByTestId('map-layers'));

    expect(screen.getByTestId('map-layers').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    for (const id of LAYER_IDS) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId('map-toggle-activities').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId('map-toggle-routes').props.accessibilityState).toMatchObject({
      checked: false,
    });

    fireEvent.press(screen.getByTestId('map-toggle-routes'));
    fireEvent.press(screen.getByTestId('map-toggle-heatmap'));
    expect(handlers.onToggleRoutes).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleHeatmap).toHaveBeenCalledTimes(1);
    // A toggle leaves the menu open, so several layers change in one visit.
    expect(screen.getByTestId('map-toggle-sections')).toBeTruthy();
  });

  it('closes the menu on fit-all, on the layers control again, and on a tap outside it', () => {
    const handlers = renderStack();

    fireEvent.press(screen.getByTestId('map-layers'));
    fireEvent.press(screen.getByTestId('map-fit-all'));
    expect(handlers.onFitAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('map-fit-all')).toBeNull();

    fireEvent.press(screen.getByTestId('map-layers'));
    fireEvent.press(screen.getByTestId('map-layers'));
    expect(screen.queryByTestId('map-toggle-activities')).toBeNull();

    fireEvent.press(screen.getByTestId('map-layers'));
    fireEvent.press(screen.getByTestId('map-layers-backdrop'));
    expect(screen.queryByTestId('map-toggle-activities')).toBeNull();
  });

  it('lists only the layers that have something to show', () => {
    renderStack({ sectionCount: 0, routeCount: 0, onToggleHeatmap: undefined });

    fireEvent.press(screen.getByTestId('map-layers'));

    expect(screen.getByTestId('map-toggle-activities')).toBeTruthy();
    expect(screen.getByTestId('map-fit-all')).toBeTruthy();
    for (const id of ['map-toggle-sections', 'map-toggle-heatmap', 'map-toggle-routes']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('offers no layers control when the map has nothing to layer', () => {
    renderStack({
      activityCount: 0,
      sectionCount: 0,
      routeCount: 0,
      onToggleHeatmap: undefined,
    });

    expect(screen.queryByTestId('map-layers')).toBeNull();
    expect(screen.getByTestId('map-location')).toBeTruthy();
  });
});
