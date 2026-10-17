/**
 * Scenario: a range change keeps the previous range's render on screen while
 * the new one is read, and that render was drawn at full strength, so the
 * athlete read the old range's figures as the new one's.
 *
 * Expected behaviour: a held render is drawn at the dim step of the alpha
 * ladder and reports itself busy, and a current one is drawn at full strength
 * and reports nothing.
 */

import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import { HeldRender } from '@/shared/ui/HeldRender';
import { opacity } from '@/theme';
import type { PowerCurve } from '@/types';

const curve: PowerCurve = {
  type: 'power',
  sport: 'Ride',
  secs: [5, 60, 300, 1200, 3600],
  watts: [800, 500, 350, 300, 260],
};

const mockQuery: { isPlaceholderData: boolean } = { isPlaceholderData: false };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({
    data: curve,
    isLoading: false,
    error: null,
    isPlaceholderData: mockQuery.isPlaceholderData,
  }),
}));

beforeEach(() => {
  mockQuery.isPlaceholderData = false;
});

describe('a chart holding its previous render', () => {
  it('dims the plot and reports it busy while the held curve is the previous range', async () => {
    mockQuery.isPlaceholderData = true;
    await render(<PowerCurveChart />);

    const plot = screen.getByRole('image');
    expect(plot).toHaveStyle({ opacity: opacity.dim });
    expect(plot).toBeBusy();
  });

  it('draws the plot at full strength once the curve is the range asked for', async () => {
    await render(<PowerCurveChart />);

    const plot = screen.getByRole('image');
    expect(plot).not.toHaveStyle({ opacity: opacity.dim });
    expect(plot).not.toBeBusy();
  });
});

describe('a screen part holding its previous render', () => {
  it('dims what it holds and reports it busy', async () => {
    await render(
      <HeldRender held testID="held">
        <Text>last week</Text>
      </HeldRender>
    );

    expect(screen.getByTestId('held')).toHaveStyle({ opacity: opacity.dim });
    expect(screen.getByTestId('held')).toBeBusy();
    expect(screen.getByText('last week')).toBeTruthy();
  });

  it('leaves current content at full strength', async () => {
    await render(
      <HeldRender held={false} testID="held">
        <Text>this week</Text>
      </HeldRender>
    );

    expect(screen.getByTestId('held')).not.toHaveStyle({ opacity: opacity.dim });
    expect(screen.getByTestId('held')).not.toBeBusy();
  });
});
