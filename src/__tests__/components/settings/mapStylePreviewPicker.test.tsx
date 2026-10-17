import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { MapStylePreviewPicker } from '@/features/settings/components/MapStylePreviewPicker';
import { Terrain3DPicker } from '@/features/settings/components/Terrain3DPicker';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

/** The narrowest row a picker gets: a 320 pt phone less the slide's and the row's padding. */
const NARROW_ROW = 240;

async function layOut(testID: string, width: number) {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 120 } },
  });
}

/**
 * Each option is a circle with its whole label under it: the circle is round and fits its third
 * of the row, and the label is a line of its own with no line cap, so a long translation or the
 * largest system text size wraps it rather than cutting it off.
 */
function expectCircleOverWholeLabel(optionTestID: string, label: string, rowWidth: number) {
  const option = screen.getByTestId(optionTestID);
  const optionStyle = StyleSheet.flatten(option.props.style);
  expect(optionStyle.flexDirection ?? 'column').toBe('column');

  const circle = StyleSheet.flatten(
    within(option).getByTestId(`${optionTestID}-circle`).props.style
  );
  // A square drawn with a radius of at least half its side is a circle.
  expect(circle.width).toBe(circle.height);
  expect(Number(circle.borderRadius)).toBeGreaterThanOrEqual(Number(circle.width) / 2);
  expect(Number(circle.width)).toBeGreaterThanOrEqual(40);
  expect(Number(circle.width)).toBeLessThanOrEqual(rowWidth / 3);

  const text = within(option).getByText(label);
  expect(text.props.numberOfLines).toBeUndefined();
  expect(text.props.adjustsFontSizeToFit).toBeFalsy();
  expect(text.props.maxFontSizeMultiplier).toBeUndefined();
  expect(StyleSheet.flatten(text.props.style).textAlign).toBe('center');
}

it('announces the selected map style and lets another style be chosen', async () => {
  const onValueChange = jest.fn();
  await render(<MapStylePreviewPicker value="dark" onValueChange={onValueChange} />);

  expect(
    screen.getByRole('button', { name: 'settings.dark' }).props.accessibilityState.selected
  ).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'settings.satellite' }));
  expect(onValueChange).toHaveBeenCalledWith('satellite');
});

it('draws each map style as a circle over its whole label at the narrowest row', async () => {
  await render(<MapStylePreviewPicker value="light" onValueChange={jest.fn()} />);
  await layOut('map-style-picker', NARROW_ROW);

  for (const style of ['light', 'dark', 'satellite']) {
    expectCircleOverWholeLabel(`map-style-${style}`, `settings.${style}`, NARROW_ROW);
  }
});

it('keeps the full circle on a wide row', async () => {
  await render(<MapStylePreviewPicker value="light" onValueChange={jest.fn()} />);
  await layOut('map-style-picker', 600);

  const circle = StyleSheet.flatten(screen.getByTestId('map-style-light-circle').props.style);
  expect(circle.width).toBe(70);
});

it('draws the 3D terrain choice as circles to match, and reports the one chosen', async () => {
  const onValueChange = jest.fn();
  await render(<Terrain3DPicker value="smart" onValueChange={onValueChange} />);
  await layOut('terrain-3d-picker', NARROW_ROW);

  for (const mode of ['off', 'smart', 'always']) {
    const key = `settings.terrain3D${mode[0].toUpperCase()}${mode.slice(1)}`;
    expectCircleOverWholeLabel(`terrain-3d-${mode}`, key, NARROW_ROW);
  }
  expect(
    screen.getByRole('button', { name: 'settings.terrain3DSmart' }).props.accessibilityState
      .selected
  ).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'settings.terrain3DAlways' }));
  expect(onValueChange).toHaveBeenCalledWith('always');
});
