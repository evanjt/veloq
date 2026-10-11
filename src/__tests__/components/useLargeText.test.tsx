/**
 * Scenario: screens decide from the system text size whether to pin chrome or
 * scroll it with their content.
 * Expected behaviour: the switch flips just past the dense-surface cap, so the
 * cap itself still counts as normal text.
 */

import { renderHook } from '@testing-library/react-native';

import { DENSE_TEXT_SCALE, useLargeText } from '@/shared/ui';

const mockDimensions = jest.fn();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => mockDimensions(),
}));

function largeTextAt(fontScale: number): boolean {
  mockDimensions.mockReturnValue({ width: 400, height: 800, scale: 3, fontScale });
  return renderHook(() => useLargeText()).result.current;
}

describe('useLargeText', () => {
  it('is false at the default size and at the cap', () => {
    expect(largeTextAt(1)).toBe(false);
    expect(largeTextAt(DENSE_TEXT_SCALE)).toBe(false);
    expect(largeTextAt(1.3)).toBe(false);
  });

  it('is true just past the cap and at the largest sizes', () => {
    expect(largeTextAt(1.31)).toBe(true);
    expect(largeTextAt(2)).toBe(true);
    expect(largeTextAt(3.57)).toBe(true);
  });
});
