/**
 * Scenario: a form refused what was typed and said so only in red text, which
 * no screen reader heard, and a unit shown beside the value was never part of
 * the field's name.
 *
 * Expected behaviour: the field's name carries its unit, the error sits under
 * the field in a polite live region for Android, and iOS hears it announced.
 */

import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { TextField } from '@/shared/ui/TextField';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

const originalOS = Platform.OS;
let announce: jest.SpyInstance;

beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = originalOS;
  announce.mockRestore();
});

function liveRegionOf(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (at.props.accessibilityLiveRegion) return at.props.accessibilityLiveRegion;
  }
  return undefined;
}

function Field({ error, unit }: { error?: string | null; unit?: string }) {
  return (
    <TextField
      testID="tank-volume"
      label="Tank volume"
      {...(unit !== undefined && { unit })}
      error={error ?? null}
      value="3"
      onChangeText={() => {}}
    />
  );
}

it('names the field by its label and unit', async () => {
  const view = await render(<Field unit="litres" />);
  const input = view.getByTestId('tank-volume');
  expect(input.props.accessibilityLabel).toContain('Tank volume');
  expect(input.props.accessibilityLabel).toContain('litres');
  expect(view.getByText('litres', { includeHiddenElements: true })).toBeTruthy();
});

it('names the field by its label alone when it has no unit', async () => {
  const view = await render(<Field />);
  expect(view.getByTestId('tank-volume').props.accessibilityLabel).toBe('Tank volume');
});

it('renders no error line while the value is accepted', async () => {
  const view = await render(<Field />);
  expect(view.queryByTestId('tank-volume-error')).toBeNull();
});

it('puts the error under the field in a polite live region', async () => {
  Platform.OS = 'android';
  const view = await render(<Field error="Enter a volume above 0." />);
  const error = view.getByTestId('tank-volume-error');
  expect(error).toHaveTextContent('Enter a volume above 0.');
  expect(liveRegionOf(error)).toBe('polite');
});

it('announces the error on iOS, once per new message', async () => {
  Platform.OS = 'ios';
  const view = await render(<Field />);
  expect(announce).not.toHaveBeenCalled();
  await view.rerender(<Field error="Enter a volume above 0." />);
  expect(announce).toHaveBeenCalledWith('Enter a volume above 0.');
  await view.rerender(<Field error="Enter a volume above 0." />);
  expect(announce).toHaveBeenCalledTimes(1);
  await view.rerender(<Field error="Enter a whole number." />);
  expect(announce).toHaveBeenLastCalledWith('Enter a whole number.');
});

it('keeps the error on the field a screen reader is focused on', async () => {
  const view = await render(<Field error="Enter a volume above 0." />);
  expect(view.getByTestId('tank-volume').props.accessibilityHint).toBe('Enter a volume above 0.');
});
