/**
 * Scenario: the detail hero floats a header, a gradient and an info overlay
 * over a full-bleed map.
 *
 * Expected behaviour: every floating layer lets touches through to the map
 * except where it draws a control, so the map still pans under the overlay.
 */

import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { DetailHero } from '@/shared/ui/DetailHero';

const renderHero = () =>
  render(
    <DetailHero height={320} overlay={<Text>Lausanne half marathon</Text>}>
      <Text>map</Text>
    </DetailHero>
  );

describe('DetailHero pointer events', () => {
  it('passes touches through the overlay to the map beneath', () => {
    renderHero();

    expect(screen.getByTestId('detail-hero-overlay').props.pointerEvents).toBe('box-none');
  });

  it('takes no touches at all on the gradient', () => {
    renderHero();

    expect(screen.getByTestId('detail-hero-gradient').props.pointerEvents).toBe('none');
  });

  it('draws no back control, the stack header owns it', () => {
    renderHero();

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('detail-hero-header')).toBeNull();
  });
});
