/**
 * Scenario: a map carrying the satellite credit, which names every regional
 * source under the viewport and runs long.
 * Expected behaviour: the credit is a bar across the map's visible bottom edge,
 * flush with it, so it takes one line at phone width rather than wrapping inside
 * a narrow corner pill. It is a licence condition so it is never truncated: past
 * one line the bar grows, and the measured height is what callers clear. On a
 * sheet's rounded top edge it stands in from the corners, so they stay rounded.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import {
  AttributionOverlay,
  ATTRIBUTION_CLEARANCE,
} from '@/features/maps/components/AttributionOverlay';

const LONG = '© swisstopo © IGN © Sentinel-2 cloudless by EOX © OpenStreetMap © OpenMapTiles';

function flatStyle(node: { props: Record<string, unknown> }): Record<string, unknown> {
  const style = node.props.style;
  const parts = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...parts.filter(Boolean));
}

describe('the map attribution bar', () => {
  it('spans the map flush with its bottom edge', async () => {
    const tree = await render(<AttributionOverlay initialAttribution={LONG} />);
    const container = flatStyle(tree.getByTestId('map-attribution'));

    expect(container.position).toBe('absolute');
    expect(container.left).toBe(0);
    expect(container.right).toBe(0);
    expect(container.bottom).toBe(0);
    expect(container.maxWidth).toBeUndefined();
    expect(container.paddingBottom ?? 0).toBe(0);
    expect(container.paddingVertical ?? 0).toBe(0);
    expect(container.padding ?? 0).toBe(0);
  });

  it('draws a square bar with no corner radius', async () => {
    const tree = await render(<AttributionOverlay initialAttribution={LONG} />);

    expect(flatStyle(tree.getByTestId('map-attribution-bar')).borderRadius).toBeUndefined();
  });

  it('sits on the edge of what covers the map foot', async () => {
    const tree = await render(<AttributionOverlay initialAttribution={LONG} bottomInset={72} />);

    expect(flatStyle(tree.getByTestId('map-attribution')).bottom).toBe(72);
  });

  it('on a rounded edge stands clear of its corners, so the edge keeps its rounding', async () => {
    const tree = await render(
      <AttributionOverlay initialAttribution={LONG} bottomInset={72} edgeRadius={28} />
    );
    const container = flatStyle(tree.getByTestId('map-attribution'));
    const bar = flatStyle(tree.getByTestId('map-attribution-bar'));

    expect(container.left).toBe(28);
    expect(container.right).toBe(28);
    expect(container.bottom).toBe(72);
    expect(bar.borderTopLeftRadius).toBeGreaterThan(0);
    expect(bar.borderTopRightRadius).toBeGreaterThan(0);
    expect(bar.borderBottomLeftRadius ?? 0).toBe(0);
    expect(bar.borderBottomRightRadius ?? 0).toBe(0);
    expect(tree.getByTestId('map-attribution-text').props.numberOfLines).toBeUndefined();
  });

  it('still shows the whole credit, however long it is', async () => {
    const tree = await render(<AttributionOverlay initialAttribution={LONG} />);
    const text = tree.getByTestId('map-attribution-text');

    expect(text.props.children).toBe(LONG);
    expect(text.props.numberOfLines).toBeUndefined();
  });

  it('reports the measured bar height as the clearance, with nothing added', async () => {
    const onClearanceChange = jest.fn();
    const tree = await render(
      <AttributionOverlay initialAttribution={LONG} onClearanceChange={onClearanceChange} />
    );

    tree.getByTestId('map-attribution-bar').props.onLayout({
      nativeEvent: { layout: { height: 16, width: 360, x: 0, y: 0 } },
    });

    expect(onClearanceChange).toHaveBeenCalledWith(16);
    expect(ATTRIBUTION_CLEARANCE).toBeGreaterThan(0);
  });
});
