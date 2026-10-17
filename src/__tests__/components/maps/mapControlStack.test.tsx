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
import { act, render, fireEvent, screen, within } from '@testing-library/react-native';
import { MapControlStack } from '@/features/maps/components/regional/MapControlStack';
import { controlHeight, layout } from '@/theme';
import { ACTIVITY_CATEGORIES } from '@/shared/activity/sportCategories';
import { initialiseI18n } from '@/i18n';
import { stubHardwareBack } from '../../__shared__/hardwareBack';

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

async function renderStack(props: Partial<React.ComponentProps<typeof MapControlStack>> = {}) {
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
  await render(
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
  it('keeps the layer toggles and fit-all out of the column until the layers menu opens', async () => {
    await renderStack();

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

  it('draws each column control at the icon-button size and reaches the tap minimum by slop', async () => {
    await renderStack();

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

  it('opens a menu with every available layer, its state, and fit-all', async () => {
    const handlers = await renderStack();

    await fireEvent.press(screen.getByTestId('map-layers'));

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

    await fireEvent.press(screen.getByTestId('map-toggle-routes'));
    await fireEvent.press(screen.getByTestId('map-toggle-heatmap'));
    expect(handlers.onToggleRoutes).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleHeatmap).toHaveBeenCalledTimes(1);
    // A toggle leaves the menu open, so several layers change in one visit.
    expect(screen.getByTestId('map-toggle-sections')).toBeTruthy();
  });

  it('closes the menu on fit-all, on the layers control again, and on a tap outside it', async () => {
    const handlers = await renderStack();

    await fireEvent.press(screen.getByTestId('map-layers'));
    await fireEvent.press(screen.getByTestId('map-fit-all'));
    expect(handlers.onFitAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('map-fit-all')).toBeNull();

    await fireEvent.press(screen.getByTestId('map-layers'));
    await fireEvent.press(screen.getByTestId('map-layers'));
    expect(screen.queryByTestId('map-toggle-activities')).toBeNull();

    await fireEvent.press(screen.getByTestId('map-layers'));
    await fireEvent.press(screen.getByTestId('map-layers-backdrop'));
    expect(screen.queryByTestId('map-toggle-activities')).toBeNull();
  });

  it('closes the open menu on back, and leaves back alone once it is shut', async () => {
    const back = stubHardwareBack();
    try {
      await renderStack();
      expect(back.press()).toBe(false);

      await fireEvent.press(screen.getByTestId('map-layers'));
      await act(() => {
        expect(back.press()).toBe(true);
      });

      expect(screen.queryByTestId('map-toggle-activities')).toBeNull();
      expect(back.press()).toBe(false);
    } finally {
      back.restore();
    }
  });

  it('lists only the layers that have something to show', async () => {
    await renderStack({ sectionCount: 0, routeCount: 0, onToggleHeatmap: undefined });

    await fireEvent.press(screen.getByTestId('map-layers'));

    expect(screen.getByTestId('map-toggle-activities')).toBeTruthy();
    expect(screen.getByTestId('map-fit-all')).toBeTruthy();
    for (const id of ['map-toggle-sections', 'map-toggle-heatmap', 'map-toggle-routes']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('offers no layers control when the map has nothing to layer', async () => {
    await renderStack({
      activityCount: 0,
      sectionCount: 0,
      routeCount: 0,
      onToggleHeatmap: undefined,
    });

    expect(screen.queryByTestId('map-layers')).toBeNull();
    expect(screen.getByTestId('map-location')).toBeTruthy();
  });

  describe('the key', () => {
    beforeAll(async () => {
      await initialiseI18n('en-GB');
    });

    const HEAT = ['#0B2F2B', '#2D7D74', '#B8EDE4'];

    async function openKey(props: Partial<React.ComponentProps<typeof MapControlStack>> = {}) {
      await renderStack({ keyCategories: ['Ride', 'Run'], heatKeyColours: HEAT, ...props });
      await fireEvent.press(screen.getByTestId('map-layers'));
    }

    const swatchColour = (rowId: string) =>
      StyleSheet.flatten(
        within(screen.getByTestId(rowId)).getByTestId('map-key-swatch').props.style
      ).backgroundColor;

    it('names each sport in view beside a swatch in the colour its dots are drawn in', async () => {
      await openKey();

      expect(swatchColour('map-key-category-Ride')).toBe(ACTIVITY_CATEGORIES.Ride.color);
      expect(swatchColour('map-key-category-Run')).toBe(ACTIVITY_CATEGORIES.Run.color);
      expect(within(screen.getByTestId('map-key-category-Ride')).getByText('Cycling')).toBeTruthy();
      expect(within(screen.getByTestId('map-key-category-Run')).getByText('Running')).toBeTruthy();
      expect(screen.queryByTestId('map-key-category-Water')).toBeNull();
    });

    it('explains the fade from a recent dot to one a year old or more', async () => {
      await openKey();

      const recency = screen.getByTestId('map-key-recency');
      expect(within(recency).getByText('Recent')).toBeTruthy();
      expect(within(recency).getByText('A year or more')).toBeTruthy();
    });

    it('draws the heat ramp from fewer to more passes while the heatmap shows', async () => {
      await openKey({ showHeatmap: true });

      const heat = screen.getByTestId('map-key-heat');
      expect(within(heat).getByText('Fewer passes')).toBeTruthy();
      expect(within(heat).getByText('More passes')).toBeTruthy();
      const steps = within(heat)
        .getAllByTestId('map-key-ramp-step')
        .map((step) => StyleSheet.flatten(step.props.style).backgroundColor);
      expect(steps[0]).toBe(HEAT[0]);
      expect(steps[steps.length - 1]).toBe(HEAT[HEAT.length - 1]);
    });

    it('hides each row with its layer', async () => {
      await openKey({ showActivities: false, showHeatmap: false });

      expect(screen.queryByTestId('map-key-category-Ride')).toBeNull();
      expect(screen.queryByTestId('map-key-recency')).toBeNull();
      expect(screen.queryByTestId('map-key-heat')).toBeNull();
    });

    it('draws no heat ramp when the map has no heatmap layer to show', async () => {
      await openKey({ showHeatmap: true, onToggleHeatmap: undefined });

      expect(screen.queryByTestId('map-key-heat')).toBeNull();
    });
  });
});
