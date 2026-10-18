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
import { Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { SheetFrame, sheetScreenLayout } from '@/shared/ui/SheetFrame';
import { SheetScrollView } from '@/shared/ui/SheetScrollView';
import { colors, darkColors } from '@/theme';

import { contrastRatio } from '../__shared__/contrast';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';

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

  it('draws the handle in the track colour, as a slider track is drawn', async () => {
    await render(
      <SheetFrame name="sheets/insight">
        <Text>body</Text>
      </SheetFrame>
    );
    const handle = screen.getByTestId('sheet-handle', { includeHiddenElements: true });
    expect(StyleSheet.flatten(handle.props.children.props.style).backgroundColor).toBe(
      colors.track
    );
  });

  it.each([
    ['light', colors],
    ['dark', darkColors],
  ])('draws a handle that holds 3:1 on the %s sheet surface', (_theme, palette) => {
    expect(contrastRatio(palette.track, palette.surface)).toBeGreaterThanOrEqual(3);
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
      <SheetFrame name="sheets/field-picker">
        <Text>body</Text>
      </SheetFrame>
    );
    expect(frameStyle().backgroundColor).toBeUndefined();
    expect(frameStyle().paddingBottom).toBe(48);
  });

  it('leaves the grabber to the system and pads a resizable sheet', async () => {
    await render(
      <SheetFrame name="sheets/field-picker">
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

describe('SheetFrame around a sheet whose root is its scroll view', () => {
  function scrollStyle() {
    return StyleSheet.flatten(screen.UNSAFE_getByType(ScrollView).props.style);
  }

  it.each(['18.5', '26.2'])(
    'draws no view around the scroll view on iOS %s, so the form sheet sizes it',
    async (version) => {
      Platform.OS = 'ios';
      setVersion(version);
      await render(
        <SheetFrame name="sheets/insight">
          <SheetScrollView>
            <Text>body</Text>
          </SheetScrollView>
        </SheetFrame>
      );
      expect(screen.queryByTestId('sheet-frame')).toBeNull();
      expect(sheetScrollPlacement(screen.toJSON())).toBe('root');
      expect(screen.getByText('body')).toBeTruthy();
    }
  );

  it('hands the scroll view the surface fill before iOS 26 and none after', async () => {
    Platform.OS = 'ios';
    setVersion('18.5');
    const sheet = (
      <SheetFrame name="sheets/chart-data">
        <SheetScrollView>
          <Text>body</Text>
        </SheetScrollView>
      </SheetFrame>
    );
    await render(sheet);
    expect(scrollStyle().backgroundColor).toBe(colors.surface);
    setVersion('26.2');
    await render(sheet);
    expect(scrollStyle().backgroundColor).toBeUndefined();
  });

  it('ends the scrolled content clear of the home indicator', async () => {
    Platform.OS = 'ios';
    setVersion('26.2');
    await render(
      <SheetFrame name="sheets/insight">
        <SheetScrollView>
          <Text>body</Text>
        </SheetScrollView>
      </SheetFrame>
    );
    const content = screen.toJSON() as ReactTestRendererJSON;
    const rows = (content.children?.[0] as ReactTestRendererJSON).children ?? [];
    const last = rows.at(-1) as ReactTestRendererJSON;
    expect(StyleSheet.flatten(last.props.style).paddingBottom).toBe(48);
  });

  it('pads the footer rather than the list when the sheet has one', async () => {
    Platform.OS = 'ios';
    setVersion('18.5');
    await render(
      <SheetFrame name="sheets/merge-confirm">
        <SheetScrollView footer={<Text testID="footer">actions</Text>}>
          <Text>body</Text>
        </SheetScrollView>
      </SheetFrame>
    );
    expect(sheetScrollPlacement(screen.toJSON())).toBe('root');
    const footer = screen.getByTestId('footer').parent?.parent;
    expect(StyleSheet.flatten(footer?.props.style)).toEqual({
      backgroundColor: colors.surface,
      paddingBottom: 48,
    });
    const list = (screen.toJSON() as ReactTestRendererJSON[])[0];
    expect((list.children?.[0] as ReactTestRendererJSON).children).toHaveLength(1);
  });

  it('keeps the frame view and its handle on Android', async () => {
    Platform.OS = 'android';
    setVersion(35);
    await render(
      <SheetFrame name="sheets/insight">
        <SheetScrollView>
          <Text>body</Text>
        </SheetScrollView>
      </SheetFrame>
    );
    expect(frameStyle().paddingBottom).toBe(48);
    expect(screen.getByTestId('sheet-handle', { includeHiddenElements: true })).toBeTruthy();
    expect(scrollStyle().backgroundColor).toBeUndefined();
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
