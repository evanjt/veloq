/**
 * Scenario: the activity hero's stats row shares the hero with the map's button column.
 *
 * Expected behaviour: the hero overlay's right padding clears the column's footprint.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { DetailHero } from '@/shared/ui/DetailHero';

describe('DetailHero overlay inset', () => {
  it('pads the overlay on the right by the inset it is given', () => {
    const { getByTestId } = render(
      <DetailHero height={250} overlayInsetEnd={72} overlay={<></>}>
        <></>
      </DetailHero>
    );
    const style = StyleSheet.flatten(getByTestId('detail-hero-overlay').props.style);
    expect(style.paddingRight).toBe(72);
  });
});
