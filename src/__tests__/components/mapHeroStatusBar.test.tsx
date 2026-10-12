/**
 * Scenario: a map-hero screen asks for light status bar glyphs. The stack keeps a covered screen
 * mounted and frozen, so a status bar entry it mounted outlives its focus and carries white
 * glyphs onto a light screen pushed on top of it.
 *
 * Expected behaviour: the entry exists only while its screen is mockFocused, carries the owner's
 * style for the hero and scrolled states, and leaves when the screen loses focus.
 */

import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { MapHeroStatusBar } from '@/shared/app/MapHeroStatusBar';

let mockFocused = true;

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => mockFocused,
}));

jest.mock('expo-status-bar', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('expo-status-bar'),
    StatusBar: (props: { style: string }) => (
      <MockView testID="status-bar-entry" accessibilityLabel={props.style} />
    ),
  };
});

const entryStyle = () => screen.getByTestId('status-bar-entry').props.accessibilityLabel;

describe('MapHeroStatusBar', () => {
  beforeEach(() => {
    mockFocused = true;
  });

  it('asks for light glyphs over the hero in either theme', async () => {
    await render(<MapHeroStatusBar scrolledPastHero={false} isDark={false} />);
    expect(entryStyle()).toBe('light');
    await screen.rerender(<MapHeroStatusBar scrolledPastHero={false} isDark />);
    expect(entryStyle()).toBe('light');
  });

  it("follows the theme's glyphs once the hero has scrolled away", async () => {
    await render(<MapHeroStatusBar scrolledPastHero isDark={false} />);
    expect(entryStyle()).toBe('dark');
    await screen.rerender(<MapHeroStatusBar scrolledPastHero isDark />);
    expect(entryStyle()).toBe('light');
  });

  it('holds no entry while its screen is covered', async () => {
    mockFocused = false;
    await render(
      <View>
        <MapHeroStatusBar scrolledPastHero={false} isDark={false} />
      </View>
    );
    expect(screen.queryByTestId('status-bar-entry')).toBeNull();
  });
});
