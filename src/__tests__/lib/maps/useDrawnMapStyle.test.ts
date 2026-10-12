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

  it('draws satellite online', async () => {
    expect(await (await renderHook(() => useDrawnMapStyle('satellite'))).result.current).toBe(
      'satellite'
    );
  });

  it('draws the theme vector basemap offline', async () => {
    mockOnline = false;
    expect(await (await renderHook(() => useDrawnMapStyle('satellite'))).result.current).toBe(
      'light'
    );
    mockDark = true;
    expect(await (await renderHook(() => useDrawnMapStyle('satellite'))).result.current).toBe(
      'dark'
    );
  });

  it('follows the connection coming back', async () => {
    mockOnline = false;
    const { result, rerender } = await renderHook(() => useDrawnMapStyle('satellite'));
    expect(result.current).toBe('light');
    mockOnline = true;
    await rerender({});
    expect(result.current).toBe('satellite');
  });

  it('leaves a vector choice alone offline', async () => {
    mockOnline = false;
    expect(await (await renderHook(() => useDrawnMapStyle('dark'))).result.current).toBe('dark');
  });
});
