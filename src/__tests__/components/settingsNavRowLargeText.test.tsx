/**
 * Scenario: at accessibility text sizes a settings row kept its title and its
 * value side by side on one line each, so both cut off and the reader could
 * not tell which row opened what.
 *
 * Expected behaviour: past the dense cap the title wraps with no line limit and
 * the value moves under it, up to two lines and with no width cap. At the
 * default size the row is unchanged: one line each, side by side.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SettingsNavRow } from '@/features/settings/components/SettingsNavRow';

const mockDimensions = jest.fn();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => mockDimensions(),
}));

const TITLE = 'Lighthouse lamp rotation and beam colour';
const SUBTITLE = 'Amber sweep';

function hostParent(node: ReactTestInstance): ReactTestInstance | null {
  let parent = node.parent;
  while (parent && typeof parent.type !== 'string') parent = parent.parent;
  return parent;
}

function direction(node: ReactTestInstance | null): string {
  return StyleSheet.flatten(node?.props.style)?.flexDirection ?? 'column';
}

function renderAt(fontScale: number) {
  mockDimensions.mockReturnValue({ width: 360, height: 800, scale: 3, fontScale });
  return render(
    <SettingsNavRow icon="cog" title={TITLE} subtitle={SUBTITLE} onPress={jest.fn()} testID="nav" />
  );
}

describe('SettingsNavRow at large text', () => {
  it('wraps the title and puts the value under it', () => {
    const { getByText } = renderAt(2);
    const title = getByText(TITLE);
    const subtitle = getByText(SUBTITLE);

    expect(title.props.numberOfLines).toBeUndefined();
    expect(subtitle.props.numberOfLines).toBe(2);
    expect(StyleSheet.flatten(subtitle.props.style).maxWidth).toBeUndefined();

    const column = hostParent(title);
    expect(hostParent(subtitle) === column).toBe(true);
    expect(column?.props.testID).not.toBe('nav');
    expect(direction(column)).toBe('column');
  });

  it('keeps one line each, side by side, at the default size', () => {
    const { getByText } = renderAt(1);
    const title = getByText(TITLE);
    const subtitle = getByText(SUBTITLE);

    expect(title.props.numberOfLines).toBe(1);
    expect(subtitle.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(subtitle.props.style).maxWidth).toBe('45%');
    const row = hostParent(title);
    expect(hostParent(subtitle) === row).toBe(true);
    expect(row?.props.testID).toBe('nav');
    expect(direction(row)).toBe('row');
  });

  it('wraps a title with no value at large text', () => {
    mockDimensions.mockReturnValue({ width: 360, height: 800, scale: 3, fontScale: 2 });
    const { getByText } = render(
      <SettingsNavRow icon="cog" title={TITLE} onPress={jest.fn()} testID="nav" />
    );
    expect(getByText(TITLE).props.numberOfLines).toBeUndefined();
  });
});
