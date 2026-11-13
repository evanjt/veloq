/**
 * Scenario: the feed, routes and sections lists share one search bar.
 *
 * Expected behaviour: typing keeps the athlete's case, the keyboard follows the
 * app theme, and the clear button appears only with text and empties the field.
 * The bar is a solid input well with a tertiary placeholder and the body text
 * style, and focus draws a 2 pt focus ring without moving the bar.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { colors, stroke, typography } from '@/theme';
import { SearchBar } from '@/shared/ui/SearchBar';

type Flat = Record<string, unknown>;

function flat(node: ReactTestInstance): Flat {
  return (StyleSheet.flatten(node.props.style) ?? {}) as Flat;
}

function hostParent(node: ReactTestInstance): ReactTestInstance {
  let at = node.parent;
  while (at && typeof at.type !== 'string') at = at.parent;
  if (!at) throw new Error('no host parent');
  return at;
}

function ringsUnder(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      flat(node).borderColor === colors.focusRing &&
      flat(node).borderWidth === stroke.two
  );
}

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t:${key}` }),
}));

describe('SearchBar', () => {
  it('does not capitalise what is typed and sets the field up for search', async () => {
    const { getByTestId } = await render(
      <SearchBar value="" onChangeText={() => {}} placeholder="Search" testID="bar" />
    );
    const input = getByTestId('bar');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.returnKeyType).toBe('search');
    expect(input.props.keyboardAppearance).toBeDefined();
  });

  it('shows the clear button only when there is text, and clears it', async () => {
    const onChangeText = jest.fn();
    const empty = await render(
      <SearchBar value="" onChangeText={onChangeText} placeholder="Search" />
    );
    expect(empty.queryByLabelText('t:common.clearSearch')).toBeNull();
    await empty.unmount();

    const filled = await render(
      <SearchBar value="loop" onChangeText={onChangeText} placeholder="Search" />
    );
    await fireEvent.press(filled.getByLabelText('t:common.clearSearch'));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('draws a solid input well with a tertiary placeholder and the body text style', async () => {
    const { getByTestId } = await render(
      <SearchBar value="" onChangeText={() => {}} placeholder="Search" testID="bar" />
    );
    const input = getByTestId('bar');
    expect(input.props.placeholderTextColor).toBe(colors.textTertiary);
    expect(flat(input).fontFamily).toBe(typography.bodyMedium.fontFamily);
    expect(flat(input).lineHeight).toBe(typography.bodyMedium.lineHeight);
    expect(flat(hostParent(input)).backgroundColor).toBe(colors.surfaceInput);
  });

  it('draws the focus ring only while focused, inside the bar', async () => {
    const view = await render(
      <SearchBar value="" onChangeText={() => {}} placeholder="Search" testID="bar" />
    );
    const input = view.getByTestId('bar');
    const bar = hostParent(input);
    expect(ringsUnder(view.root)).toHaveLength(0);
    const idle = flat(bar);

    await fireEvent(input, 'focus');
    const rings = ringsUnder(view.root);
    expect(rings).toHaveLength(1);
    expect(rings[0].props.pointerEvents).toBe('none');
    expect(flat(rings[0]).position).toBe('absolute');
    expect(flat(bar)).toEqual(idle);

    await fireEvent(input, 'blur');
    expect(ringsUnder(view.root)).toHaveLength(0);
  });
});
