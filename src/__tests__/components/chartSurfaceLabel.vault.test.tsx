/**
 * Scenario: a chart's plot is one image whose spoken name is the sentence the
 * chart summary builds, and the screen reader adds the image role after it.
 *
 * Expected behaviour: the plot's spoken name keeps every sentence of the summary
 * and drops the full stop that ends it.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';

import { ChartSurface } from '@/shared/charts/ChartSurface';

describe('ChartSurface', () => {
  it('speaks the summary without the full stop that ends it', () => {
    const tree = render(
      <ChartSurface
        summary="Activity chart. Power, 0.00 mi to 27.96 mi: latest 117 W, range 84 W to 249 W, average 177 W."
        table={null}
      >
        <View />
      </ChartSurface>
    );

    expect(tree.getByRole('image').props.accessibilityLabel).toBe(
      'Activity chart. Power, 0.00 mi to 27.96 mi: latest 117 W, range 84 W to 249 W, average 177 W'
    );
  });
});
