/**
 * Scenario: a map sheet holds a root card and a card pushed over it. Every card stays mounted, so
 * the root card's scroll view is still in the tree, ahead of the pushed card's. Android's form
 * sheet hands a drag to the first view, depth first, that scrolls nested.
 *
 * Expected behaviour: only the card on show scrolls nested, so a drag in the pushed card scrolls
 * it rather than going to the covered card; popping hands the drag back to the root card.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { MapSheetHostContext, type MapSheetHostValue } from '@/shared/app/MapSheetHost';
import { MapSheetCards, type MapSheetCardRegistry } from '@/shared/app/MapSheetCards';
import { closeHost, openHost, popHostCard, pushHostCard } from '@/shared/app/mapSheetHost';
import { SheetCardScroll } from '@/features/routes/screens/SheetCardScroll';
import { sheetScrollHandsOff } from '../__shared__/sheetScrollPlacement';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

function KilnCard({ id }: { id: string }) {
  return (
    <SheetCardScroll>
      <Text>{`kiln:${id}`}</Text>
    </SheetCardScroll>
  );
}

const REGISTRY: MapSheetCardRegistry = { route: KilnCard, section: KilnCard };
const HOST: MapSheetHostValue = {
  kind: 'route',
  id: 'glaze',
  key: 'route:glaze',
  focused: true,
  setHeaderOptions: () => undefined,
};

describe('the scroll hand-off of a map sheet holding several cards', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'android';
    openHost('route', 'glaze');
  });
  afterEach(() => {
    Platform.OS = realOS;
    closeHost(HOST.key);
  });

  function nestedScrollers(root: ReactTestInstance) {
    return root.findAll(
      (node) => String(node.type) === 'RCTScrollView' && node.props.nestedScrollEnabled === true
    );
  }

  function inside(card: ReactTestInstance, node: ReactTestInstance) {
    return card.findAll((candidate) => candidate === node).length > 0;
  }

  async function renderCards() {
    return render(
      <MapSheetHostContext.Provider value={HOST}>
        <MapSheetCards registry={REGISTRY} rootParams={{}} />
      </MapSheetHostContext.Provider>
    );
  }

  it('hands a drag to the card on show, not to the one it covers', async () => {
    const screen = await renderCards();
    expect(sheetScrollHandsOff(screen.toJSON())).toBe(true);

    await act(async () => pushHostCard(HOST.key, { kind: 'section', id: 'slip' }));
    const nested = nestedScrollers(screen.UNSAFE_root);
    expect(nested).toHaveLength(1);
    expect(inside(screen.getByTestId('map-sheet-card-1'), nested[0])).toBe(true);
  });

  it('hands the drag back to the root card once the pushed card is popped', async () => {
    const screen = await renderCards();
    await act(async () => pushHostCard(HOST.key, { kind: 'section', id: 'slip' }));
    await act(async () => popHostCard(HOST.key));
    expect(sheetScrollHandsOff(screen.toJSON())).toBe(true);
  });
});
