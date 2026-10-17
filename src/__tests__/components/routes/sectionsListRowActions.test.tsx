/**
 * Scenario: a screen reader user wants to delete, hide or restore a section
 * from the list. Those live only behind a swipe, and a screen reader takes the
 * swipe for itself.
 * Expected behaviour: the row offers the same actions the swipe reveals, with
 * the same labels, and each runs the swipe button's handler for that section.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { SectionListItem } from '@/features/routes/components/SectionsList';
import { swipeAction } from '@/theme';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const section = (id: string, sectionType: 'custom' | 'auto'): FrequentSection => ({
  id,
  name: `Section ${id}`,
  sectionType,
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
});

function draw(item: FrequentSection, isDisabled: boolean) {
  const onDelete = jest.fn();
  const onToggleHide = jest.fn();
  render(
    <SectionListItem
      index={0}
      item={item}
      isDark={false}
      isDisabled={isDisabled}
      onPress={jest.fn()}
      onSwipeableOpen={jest.fn()}
      onDelete={onDelete}
      onToggleHide={onToggleHide}
      swipeableRefs={{ current: new Map() }}
      t={(key: string) => key}
    />
  );
  const row = screen.getByRole('button');
  const fire = (name: string) =>
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: name } });
  return { row, fire, onDelete, onToggleHide };
}

describe('a section row for a screen reader', () => {
  it('deletes a custom section', () => {
    const custom = section('c1', 'custom');
    const { row, fire, onDelete, onToggleHide } = draw(custom, false);

    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'common.delete' }]);
    fire('delete');
    expect(onDelete).toHaveBeenCalledWith(custom);
    expect(onToggleHide).not.toHaveBeenCalled();
  });

  it('restores a hidden section', () => {
    const hidden = section('h1', 'auto');
    const { row, fire, onToggleHide } = draw(hidden, true);

    expect(row.props.accessibilityActions).toEqual([{ name: 'restore', label: 'common.restore' }]);
    fire('restore');
    expect(onToggleHide).toHaveBeenCalledWith(hidden);
  });

  it('removes a shown detected section', () => {
    const shown = section('s1', 'auto');
    const { row, fire, onToggleHide } = draw(shown, false);

    expect(row.props.accessibilityActions).toEqual([{ name: 'remove', label: 'common.remove' }]);
    fire('remove');
    expect(onToggleHide).toHaveBeenCalledWith(shown);
  });
});

/** The action the row reveals under a full swipe: its label, glyph and fill. */
async function swipedAction(item: FrequentSection, isDisabled: boolean) {
  draw(item, isDisabled);
  const reveal = screen.UNSAFE_getByType(Swipeable).props.renderRightActions;
  const swipe = await render(reveal(null, { value: -80 }));
  const text = swipe.getByText(/^common\./);
  let fill: unknown;
  for (let node = text.parent; node && fill === undefined; node = node.parent) {
    fill = StyleSheet.flatten(node.props.style)?.backgroundColor;
  }
  return {
    label: text.props.children,
    ink: StyleSheet.flatten(text.props.style).color,
    glyph: swipe.UNSAFE_queryAllByType(MaterialCommunityIcons)[0]?.props.name,
    fill,
  };
}

describe('a section row swipe', () => {
  it('draws removing a detected section as the reversible remove, not a delete', async () => {
    expect(await swipedAction(section('s1', 'auto'), false)).toEqual({
      label: 'common.remove',
      ink: swipeAction.hide.text,
      glyph: 'minus-circle-outline',
      fill: swipeAction.hide.bg,
    });
  });

  it('draws restoring a removed section as the restore', async () => {
    expect(await swipedAction(section('h1', 'auto'), true)).toEqual({
      label: 'common.restore',
      ink: swipeAction.restore.text,
      glyph: 'undo',
      fill: swipeAction.restore.bg,
    });
  });

  it('keeps deleting a custom section on the destructive fill', async () => {
    const drawn = await swipedAction(section('c1', 'custom'), false);
    expect(drawn).toMatchObject({
      label: 'common.delete',
      ink: swipeAction.destructive.text,
      fill: swipeAction.destructive.bg,
    });
  });
});
