/**
 * Scenario: a detail hero's stats row shares the hero with a map's button column.
 *
 * Expected behaviour: the hero overlay's right padding clears the inset it is given.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DetailHero } from '@/shared/ui/DetailHero';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

describe('DetailHero overlay inset', () => {
  it('pads the overlay on the right by the inset it is given', async () => {
    const { getByTestId } = await render(
      <DetailHero height={250} overlayInsetEnd={72} overlay={<></>}>
        <></>
      </DetailHero>
    );
    const style = StyleSheet.flatten(getByTestId('detail-hero-overlay').props.style);
    expect(style.paddingRight).toBe(72);
  });
});
