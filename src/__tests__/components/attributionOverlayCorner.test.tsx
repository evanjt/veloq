/**
 * Scenario: a map taking 30 % of the screen height carrying the satellite credit,
 * which names every regional source under the viewport and runs long.
 * Expected behaviour: the credit stays a pill in one corner. It is a licence
 * condition so it is never hidden or truncated, but it is not allowed to grow
 * into a full-width band across the bottom of the map.
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

describe('the map attribution overlay', () => {
  it('anchors in one corner and never spans the map', () => {
    const tree = render(<AttributionOverlay initialAttribution={LONG} />);
    const container = flatStyle(tree.getByTestId('map-attribution'));

    expect(container.position).toBe('absolute');
    expect(container.bottom).toBe(0);
    expect(container.right).toBe(0);
    expect(container.left).toBeUndefined();
    expect(container.maxWidth).toBeDefined();
    expect(container.maxWidth).not.toBe('100%');
  });

  it('sizes the pill to its text rather than to the container', () => {
    const tree = render(<AttributionOverlay initialAttribution={LONG} />);

    expect(flatStyle(tree.getByTestId('map-attribution-pill')).alignSelf).toBe('flex-end');
  });

  it('still shows the whole credit, however long it is', () => {
    const tree = render(<AttributionOverlay initialAttribution={LONG} />);
    const text = tree.getByTestId('map-attribution-text');

    expect(text.props.children).toBe(LONG);
    expect(text.props.numberOfLines).toBeUndefined();
  });

  it('still reports a clearance so content in the same corner can pad clear', () => {
    const onClearanceChange = jest.fn();
    const tree = render(
      <AttributionOverlay initialAttribution={LONG} onClearanceChange={onClearanceChange} />
    );

    tree.getByTestId('map-attribution-pill').props.onLayout({
      nativeEvent: { layout: { height: 30, width: 100, x: 0, y: 0 } },
    });

    expect(onClearanceChange).toHaveBeenCalledWith(34);
    expect(ATTRIBUTION_CLEARANCE).toBeGreaterThan(0);
  });
});
