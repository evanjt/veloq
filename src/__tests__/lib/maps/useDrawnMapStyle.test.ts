/**
 * Scenario: satellite is chosen, then the radio goes off and comes back.
 *
 * Expected behaviour: the style a surface draws is the vector basemap while
 * offline and satellite again once online, with the chosen style untouched.
 */
import { renderHook } from '@testing-library/react-native';
import { useDrawnMapStyle } from '@/features/maps/hooks/useDrawnMapStyle';

let mockOnline = true;
let mockDark = false;
jest.mock('@/shared/app/NetworkContext', () => ({ useIsOnline: () => mockOnline }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));

describe('useDrawnMapStyle', () => {
  beforeEach(() => {
    mockOnline = true;
    mockDark = false;
  });

  it('draws satellite online', () => {
    expect(renderHook(() => useDrawnMapStyle('satellite')).result.current).toBe('satellite');
  });

  it('draws the theme vector basemap offline', () => {
    mockOnline = false;
    expect(renderHook(() => useDrawnMapStyle('satellite')).result.current).toBe('light');
    mockDark = true;
    expect(renderHook(() => useDrawnMapStyle('satellite')).result.current).toBe('dark');
  });

  it('follows the connection coming back', () => {
    mockOnline = false;
    const { result, rerender } = renderHook(() => useDrawnMapStyle('satellite'));
    expect(result.current).toBe('light');
    mockOnline = true;
    rerender({});
    expect(result.current).toBe('satellite');
  });

  it('leaves a vector choice alone offline', () => {
    mockOnline = false;
    expect(renderHook(() => useDrawnMapStyle('dark')).result.current).toBe('dark');
  });
});
