import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';

const mockTextRender = jest.fn();
jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  const React = require('react');
  return {
    ...actual,
    Text: (props: { children: React.ReactNode }) => {
      mockTextRender(props.children);
      return React.createElement(actual.Text, props);
    },
  };
});
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({
    isDark: false,
    colors: { text: '#111', textSecondary: '#666' },
  }),
}));
jest.mock('@/shared/ui', () => ({
  accessibleActions: jest.requireActual('@/shared/ui/accessibleActions').accessibleActions,
  pressable: (styles: unknown) => styles,
  pressRipple: {},
}));

const fields = ['speed', 'distance', 'heartrate', 'power'] as const;
const metrics = {
  speed: 4,
  avgSpeed: 4,
  distance: 1000,
  heartrate: 135,
  power: 220,
  cadence: 80,
  elevation: 100,
  elevationGain: 10,
  calories: 100,
  lapDistance: 100,
  lapTime: 10,
  elapsedTime: 20,
  movingTime: 20,
};

it('renders only a tile whose displayed value changes', async () => {
  const props = { fields: [...fields], metrics, isMetric: true };
  const { rerender } = await render(<DataFieldGrid {...props} />);
  expect(mockTextRender).toHaveBeenCalledTimes(8);

  mockTextRender.mockClear();
  await rerender(
    <DataFieldGrid
      {...props}
      metrics={{ ...metrics, elapsedTime: 21, movingTime: 21, lapTime: 11 }}
    />
  );
  expect(mockTextRender).not.toHaveBeenCalled();

  await rerender(<DataFieldGrid {...props} metrics={{ ...metrics, speed: 5 }} />);
  expect(mockTextRender).toHaveBeenCalledTimes(2);
  expect(mockTextRender).toHaveBeenCalledWith('recording.fields.speed');
});
