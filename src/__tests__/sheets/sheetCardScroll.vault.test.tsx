/**
 * Scenario: a card pushed into a map sheet, a section's history or its laps, scrolls through the
 * sheet card scroll, and on Android the sheet hands a drag to its content only through a view
 * that scrolls nested.
 *
 * Expected behaviour: the card's scroll view is that view, so a drag in the card scrolls the card
 * rather than moving the sheet.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { SheetCardScroll } from '@/features/routes/screens/SheetCardScroll';
import { sheetScrollHandsOff } from '../__shared__/sheetScrollPlacement';

describe('the scroll of a card pushed into a map sheet', () => {
  it('hands a drag in the sheet on Android to the card', async () => {
    const realOS = Platform.OS;
    Platform.OS = 'android';
    try {
      const screen = await render(
        <SheetCardScroll>
          <Text>Glaze firings</Text>
        </SheetCardScroll>
      );
      expect(sheetScrollHandsOff(screen.toJSON())).toBe(true);
    } finally {
      Platform.OS = realOS;
    }
  });
});
