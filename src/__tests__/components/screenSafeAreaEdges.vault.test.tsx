/**
 * Scenario: a screen under a native stack header, or one with no header, wraps itself in the
 * screen safe area. The header already clears the status bar, transparent or not.
 *
 * Expected behaviour: the safe area reads whether a header is shown from the navigator and takes
 * the top edge only when none is, so no caller has to say so and none pads the status bar twice.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeaderShownContext } from 'expo-router/react-navigation';

import { ScreenSafeAreaView } from '@/shared/ui/ScreenSafeAreaView';

let mockScreenEdges = ['top', 'bottom', 'left', 'right'];

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useScreenSafeAreaEdges: () => mockScreenEdges,
}));

async function edgesUnder(headerShown: boolean | undefined) {
  const view = (
    <ScreenSafeAreaView>
      <Text>body</Text>
    </ScreenSafeAreaView>
  );
  const screen = await render(
    headerShown === undefined ? (
      view
    ) : (
      <HeaderShownContext.Provider value={headerShown}>{view}</HeaderShownContext.Provider>
    )
  );
  return screen.UNSAFE_getByType(SafeAreaView).props.edges;
}

beforeEach(() => {
  mockScreenEdges = ['top', 'bottom', 'left', 'right'];
});

describe('ScreenSafeAreaView', () => {
  it('leaves the top edge to a shown native header', async () => {
    expect(await edgesUnder(true)).toEqual(['bottom', 'left', 'right']);
  });

  it('takes the top edge on a screen whose header is hidden', async () => {
    expect(await edgesUnder(false)).toEqual(['top', 'bottom', 'left', 'right']);
  });

  it('takes the top edge outside any navigator', async () => {
    expect(await edgesUnder(undefined)).toEqual(['top', 'bottom', 'left', 'right']);
  });

  it('leaves the top edge to a banner whether or not a header is shown', async () => {
    mockScreenEdges = ['bottom', 'left', 'right'];
    expect(await edgesUnder(true)).toEqual(['bottom', 'left', 'right']);
    expect(await edgesUnder(false)).toEqual(['bottom', 'left', 'right']);
  });
});
