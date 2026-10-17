/**
 * Scenario: the native stack draws an Android sheet with no drag handle and
 * runs its content under the navigation bar, so the last row of a sheet sits
 * behind the system buttons.
 *
 * Expected behaviour: every sheet route renders inside one frame, which draws
 * the handle on a resizable Android sheet and pads the content clear of the
 * bottom inset.
 */
import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SheetFrame, sheetScreenLayout } from '@/shared/ui/SheetFrame';
import { colors } from '@/theme';

const mockInsets = { top: 0, bottom: 48, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => mockInsets,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const originalOS = Platform.OS;
const originalVersion = Platform.Version;

function setVersion(version: string | number) {
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}

afterEach(() => {
  Platform.OS = originalOS;
  setVersion(originalVersion);
});

function frameStyle() {
  return StyleSheet.flatten(screen.getByTestId('sheet-frame').props.style);
}

describe('SheetFrame on Android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    setVersion(35);
  });

  it('paints the sheet surface', async () => {
    await render(
      <SheetFrame name="sheets/smoothing">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(frameStyle().backgroundColor).toBe(colors.surface);
  });

  it('draws the handle on a resizable sheet and pads past the navigation bar', async () => {
    await render(
      <SheetFrame name="sheets/insight">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(screen.getByTestId('sheet-handle', { includeHiddenElements: true })).toBeTruthy();
    expect(frameStyle().paddingBottom).toBe(48);
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('draws no handle on a sheet sized to its content, and still pads it', async () => {
    await render(
      <SheetFrame name="sheets/smoothing">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(screen.queryByTestId('sheet-handle', { includeHiddenElements: true })).toBeNull();
    expect(frameStyle().paddingBottom).toBe(48);
  });

  it('hides the handle from assistive technology, since it carries no action', async () => {
    await render(
      <SheetFrame name="sheets/field-picker">
        <Text>body</Text>
      </SheetFrame>
    );
    const handle = screen.getByTestId('sheet-handle', { includeHiddenElements: true });
    expect(handle.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(handle.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('SheetFrame on iOS', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
    setVersion('18.5');
  });

  it('paints the sheet surface before iOS 26', async () => {
    await render(
      <SheetFrame name="sheets/smoothing">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(frameStyle().backgroundColor).toBe(colors.surface);
  });

  it('paints nothing on iOS 26 and later, so the system material is the one background', async () => {
    setVersion('26.2');
    await render(
      <SheetFrame name="sheets/insight">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(frameStyle().backgroundColor).toBeUndefined();
    expect(frameStyle().paddingBottom).toBe(48);
  });

  it('leaves the grabber to the system and pads a resizable sheet', async () => {
    await render(
      <SheetFrame name="sheets/insight">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(screen.queryByTestId('sheet-handle', { includeHiddenElements: true })).toBeNull();
    expect(frameStyle().paddingBottom).toBe(48);
  });

  it('adds no padding to a fitted sheet, which the system already ends above the indicator', async () => {
    await render(
      <SheetFrame name="sheets/smoothing">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(frameStyle().paddingBottom).toBe(0);
  });
});

describe('sheetScreenLayout', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('frames a sheet route', async () => {
    await render(
      sheetScreenLayout({ route: { name: 'sheets/insight' }, children: <Text>body</Text> })
    );
    expect(screen.getByTestId('sheet-frame')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('passes any other route through untouched', async () => {
    await render(sheetScreenLayout({ route: { name: 'settings' }, children: <Text>body</Text> }));
    expect(screen.queryByTestId('sheet-frame')).toBeNull();
    expect(screen.getByText('body')).toBeTruthy();
  });
});
