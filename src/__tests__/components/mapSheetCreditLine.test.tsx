/**
 * Scenario: a detail map inside a sheet host publishes its credit while a sheet covers its foot.
 * Expected behaviour: the credit is a line inside the sheet, below the handle, and the map draws
 * no bar over its own foot; with no sheet covering the map the bar is still drawn.
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { AttributionOverlay } from '@/features/maps/components/AttributionOverlay';
import { MapSheetHostContext, MapSheetHostSheet } from '@/shared/app/MapSheetHost';
import { useMapSheetCreditStore } from '@/shared/app/mapSheetCredit';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useNavigation: () => ({ getParent: () => undefined }),
}));

const host = {
  kind: 'route' as const,
  id: 'r1',
  key: 'route:r1',
  focused: true,
  setHeaderOptions: () => undefined,
};

describe('the credit inside a map sheet', () => {
  beforeEach(() => useMapSheetCreditStore.setState({ credits: {} }));

  it('is drawn by the sheet under its handle once the map publishes it', async () => {
    const tree = await render(
      <MapSheetHostContext.Provider value={host}>
        <AttributionOverlay
          initialAttribution="© Test Source"
          sheetKey="route:r1"
          bottomInset={300}
        />
        <MapSheetHostSheet>{null}</MapSheetHostSheet>
      </MapSheetHostContext.Provider>
    );
    expect(tree.queryByTestId('map-attribution')).toBeNull();
    const credit = tree.getByTestId('map-attribution-text');
    expect(credit.props.children).toBe('© Test Source');
    const sheet = tree.getByTestId('map-sheet');
    expect(sheet.findByProps({ testID: 'map-attribution-text' })).toBeTruthy();
  });

  it('keeps the bar over the map when no sheet covers it', async () => {
    const tree = await render(
      <AttributionOverlay initialAttribution="© Test Source" sheetKey="route:r1" bottomInset={0} />
    );
    expect(tree.getByTestId('map-attribution-text')).toBeTruthy();
    expect(useMapSheetCreditStore.getState().credits['route:r1']).toBeUndefined();
  });

  it('clears the published credit when the map unmounts', async () => {
    const tree = await render(
      <AttributionOverlay
        initialAttribution="© Test Source"
        sheetKey="route:r1"
        bottomInset={300}
      />
    );
    await act(async () => tree.unmount());
    expect(useMapSheetCreditStore.getState().credits['route:r1']).toBeUndefined();
  });
});
