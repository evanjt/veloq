/**
 * Scenario: satellite is chosen, then the radio goes off and comes back.
 *
 * Expected behaviour: the style a surface draws is the vector basemap while
 * offline and satellite again once online, with the chosen style untouched.
 */
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { useDrawnMapStyle, useMapStyleToggle } from '@/features/maps/hooks/useDrawnMapStyle';

let mockOnline = true;
let mockDark = false;
jest.mock('@/shared/app/NetworkContext', () => ({ useIsOnline: () => mockOnline }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));

describe('useDrawnMapStyle', () => {
  beforeEach(() => {
    mockOnline = true;
    mockDark = false;
  });

  vaultIt('draws satellite online', async () => {
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

  vaultIt('leaves a vector choice alone offline', async () => {
    mockOnline = false;
    expect(await (await renderHook(() => useDrawnMapStyle('dark'))).result.current).toBe('dark');
  });
});

function renderToggle(initial: MapStyleType) {
  return renderHook(() => {
    const [chosen, setChosen] = useState<MapStyleType>(initial);
    return { chosen, ...useMapStyleToggle(chosen, setChosen) };
  });
}

describe('useMapStyleToggle', () => {
  beforeEach(() => {
    mockOnline = true;
    mockDark = false;
  });

  vaultIt('reaches light from dark offline in a dark theme', () => {
    mockOnline = false;
    mockDark = true;
    const { result } = renderToggle('dark');
    act(() => result.current.cycle());
    expect(result.current.drawn).toBe('light');

    act(() => result.current.cycle());
    expect(result.current.drawn).toBe('dark');
  });

  vaultIt('offers the style a tap draws, skipping satellite offline', () => {
    mockOnline = false;
    mockDark = true;
    const { result } = renderToggle('dark');
    expect(result.current.next).toBe('light');
  });

  vaultIt('cycles light and dark offline in a light theme', () => {
    mockOnline = false;
    const { result } = renderToggle('satellite');
    expect(result.current.drawn).toBe('light');
    act(() => result.current.cycle());
    expect(result.current.drawn).toBe('dark');
    expect(result.current.next).toBe('light');
  });

  vaultIt('keeps satellite in the three step cycle online', () => {
    const { result } = renderToggle('light');
    expect(result.current.next).toBe('dark');
    act(() => result.current.cycle());
    expect(result.current.next).toBe('satellite');
    act(() => result.current.cycle());
    expect(result.current.drawn).toBe('satellite');
    expect(result.current.next).toBe('light');
  });
});
