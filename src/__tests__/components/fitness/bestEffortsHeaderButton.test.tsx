import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { BestEffortsHeaderButton } from '@/features/fitness/components/BestEffortsHeaderButton';

it('opens Best Efforts from the Fitness header', () => {
  const push = jest.spyOn(router, 'push').mockImplementation(jest.fn());

  render(<BestEffortsHeaderButton />);
  fireEvent.press(screen.getByTestId('fitness-best-efforts-button'));

  expect(push).toHaveBeenCalledWith('/best-efforts');
  expect(screen.getByText('bestEffortsScreen.title')).toBeTruthy();
});
