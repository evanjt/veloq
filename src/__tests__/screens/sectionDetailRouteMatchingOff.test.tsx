/**
 * Scenario: route matching is off and a link opens a stored section.
 * Expected behaviour: the screen shows the feature-disabled state and loads
 * nothing, its title is readable on the dark ground, and the action is a
 * button that turns matching on.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import SectionDetailScreen from '@/app/section/[id]';
import { darkColors } from '@/theme';

const mockContentRendered = jest.fn();
const mockSetEnabled = jest.fn();
let mockEnabled = false;
let mockScheme: 'light' | 'dark' = 'light';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (c: unknown) => c,
}));
jest.mock('@/shared/app/ThemeProvider', () => ({
  useResolvedColorScheme: () => mockScheme,
}));
jest.mock('@/shared/app', () => ({
  useTheme: jest.requireActual('@/shared/app/useTheme').useTheme,
}));
jest.mock('@/features/routes', () => {
  const useRouteSettings = (select: (s: unknown) => unknown) =>
    select({ settings: { enabled: mockEnabled } });
  useRouteSettings.getState = () => ({ setEnabled: mockSetEnabled });
  return {
    useRouteSettings,
    useSectionDetailData: (...args: unknown[]) => {
      mockContentRendered(...args);
      throw new Error('the section detail read ran');
    },
  };
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('section detail with route matching off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheme = 'light';
  });

  it('renders the disabled state and reads no section', () => {
    const view = render(<SectionDetailScreen />);
    expect(view.getByTestId('section-detail-disabled')).toBeTruthy();
    expect(mockContentRendered).not.toHaveBeenCalled();
  });

  it('offers a button named for the action that turns matching on', () => {
    const view = render(<SectionDetailScreen />);
    const action = view.getByRole('button', { name: 'insights.routesDisabledLine2' });

    fireEvent.press(action);

    expect(mockSetEnabled).toHaveBeenCalledTimes(1);
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
  });

  it('draws the title at 4.5:1 or better on the dark ground', () => {
    mockScheme = 'dark';
    const view = render(<SectionDetailScreen />);

    const ground = StyleSheet.flatten(view.getByTestId('section-detail-disabled').props.style);
    expect(ground.backgroundColor).toBe(darkColors.background);

    const title = StyleSheet.flatten(view.getByText('insights.routesDisabledLine1').props.style);
    expect(contrast(title.color, ground.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });
});
