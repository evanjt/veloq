/**
 * Scenario: route matching is off and a link opens a stored section.
 * Expected behaviour: the screen shows the feature-disabled state and loads nothing.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import SectionDetailScreen from '@/app/section/[id]';

const mockContentRendered = jest.fn();
let mockEnabled = false;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (c: unknown) => c,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/routes', () => {
  const useRouteSettings = (select: (s: unknown) => unknown) =>
    select({ settings: { enabled: mockEnabled } });
  useRouteSettings.getState = () => ({ setEnabled: jest.fn() });
  return {
    useRouteSettings,
    useSectionDetailData: (...args: unknown[]) => {
      mockContentRendered(...args);
      throw new Error('the section detail read ran');
    },
  };
});

describe('section detail with route matching off', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the disabled state and reads no section', () => {
    const view = render(<SectionDetailScreen />);
    expect(view.getByTestId('section-detail-disabled')).toBeTruthy();
    expect(mockContentRendered).not.toHaveBeenCalled();
  });
});
