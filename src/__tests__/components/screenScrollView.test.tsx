/**
 * Scenario: a collapsing large title only works when the screen's scroll view lets the system
 * inset its content under the title, so content sits beneath the title at rest without it.
 *
 * Expected behaviour: `ScreenScrollView` sets automatic inset adjustment on iOS and nothing on
 * Android, a caller's own value wins, and `screenListInsets` is the same fact for a `FlatList`.
 */

import React, { createRef } from 'react';
import { FlatList, ScrollView, Text } from 'react-native';
import { render } from '@testing-library/react-native';

type ScreenUi = typeof import('@/shared/ui/ScreenScrollView');

/** The module loaded as it is on `os`: an isolated registry holds its own copy of `Platform`. */
function loadFor(os: 'ios' | 'android'): ScreenUi {
  let loaded!: ScreenUi;
  jest.isolateModules(() => {
    require('react-native').Platform.OS = os;
    loaded = require('@/shared/ui/ScreenScrollView');
  });
  return loaded;
}

describe('ScreenScrollView', () => {
  it('sets automatic inset adjustment on iOS', () => {
    const { ScreenScrollView } = loadFor('ios');
    const { UNSAFE_getByType } = render(
      <ScreenScrollView>
        <Text>x</Text>
      </ScreenScrollView>
    );

    expect(UNSAFE_getByType(ScrollView).props.contentInsetAdjustmentBehavior).toBe('automatic');
  });

  it('sets nothing on Android', () => {
    const { ScreenScrollView } = loadFor('android');
    const { UNSAFE_getByType } = render(
      <ScreenScrollView>
        <Text>x</Text>
      </ScreenScrollView>
    );

    expect(UNSAFE_getByType(ScrollView).props).not.toHaveProperty('contentInsetAdjustmentBehavior');
  });

  it("lets the caller's own value win on iOS", () => {
    const { ScreenScrollView } = loadFor('ios');
    const { UNSAFE_getByType } = render(
      <ScreenScrollView contentInsetAdjustmentBehavior="never">
        <Text>x</Text>
      </ScreenScrollView>
    );

    expect(UNSAFE_getByType(ScrollView).props.contentInsetAdjustmentBehavior).toBe('never');
  });

  it('forwards the other props and the ref to the scroll view', () => {
    const { ScreenScrollView } = loadFor('ios');
    const ref = createRef<ScrollView>();
    const { getByTestId } = render(
      <ScreenScrollView ref={ref} testID="body" showsVerticalScrollIndicator={false}>
        <Text>x</Text>
      </ScreenScrollView>
    );

    expect(getByTestId('body').props.showsVerticalScrollIndicator).toBe(false);
    expect(ref.current).not.toBeNull();
  });
});

describe('screenListInsets', () => {
  it('carries automatic inset adjustment on iOS, onto a FlatList', () => {
    const { screenListInsets } = loadFor('ios');
    const { UNSAFE_getByType } = render(
      <FlatList data={['a']} renderItem={() => null} {...screenListInsets} />
    );

    expect(UNSAFE_getByType(ScrollView).props.contentInsetAdjustmentBehavior).toBe('automatic');
  });

  it('is empty on Android', () => {
    expect(loadFor('android').screenListInsets).toEqual({});
  });
});
