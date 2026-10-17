/**
 * Scenario: the native map sheet takes its stop only when it opens, so the map's expand button,
 * a tap on the handle, a screen reader's adjust gesture and a tool's return each need one place
 * that knows the stop the sheet rests at and asks for another.
 *
 * Expected behaviour: the stop is the last settled detent, a request for a different stop goes
 * to the screen's presenter once, the handle steps up and wraps Full to Peek, the adjustable
 * element reads the stop and clamps at either end, and a tool returns the sheet to the stop it
 * found.
 */
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';

import {
  MAP_SHEET_HALF_STOP,
  MAP_SHEET_PEEK_STOP,
  MAP_SHEET_FULL_STOP,
  mapSheetStopReducer,
  nextStop,
  useMapSheetStop,
  useMapSheetStops,
} from '@/shared/app/mapSheetStop';
import { MapSheetHandle } from '@/shared/ui/MapSheetHandle';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-i18next', () => {
  const { resolvedLocale } = jest.requireActual(
    '../i18n/resolvedLocale'
  ) as typeof import('../i18n/resolvedLocale');
  const bundle = resolvedLocale('en-GB');
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      i18n: { language: 'en-GB' },
      t: (key: string) => {
        const text = key
          .split('.')
          .reduce<unknown>(
            (acc, part) =>
              acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
            bundle
          );
        return typeof text === 'string' ? text : key;
      },
    }),
  };
});

const KEY = 'orchard:pear';

afterEach(() => {
  act(() => useMapSheetStops.setState({ sheets: {}, presenters: {} }));
});

describe('nextStop', () => {
  it('steps the handle up through Peek, Half and Full and wraps Full to Peek', () => {
    expect(nextStop(MAP_SHEET_PEEK_STOP, 'next')).toBe(MAP_SHEET_HALF_STOP);
    expect(nextStop(MAP_SHEET_HALF_STOP, 'next')).toBe(MAP_SHEET_FULL_STOP);
    expect(nextStop(MAP_SHEET_FULL_STOP, 'next')).toBe(MAP_SHEET_PEEK_STOP);
  });

  it('clamps an increment at Full and a decrement at Peek', () => {
    expect(nextStop(MAP_SHEET_HALF_STOP, 'up')).toBe(MAP_SHEET_FULL_STOP);
    expect(nextStop(MAP_SHEET_FULL_STOP, 'up')).toBe(MAP_SHEET_FULL_STOP);
    expect(nextStop(MAP_SHEET_HALF_STOP, 'down')).toBe(MAP_SHEET_PEEK_STOP);
    expect(nextStop(MAP_SHEET_PEEK_STOP, 'down')).toBe(MAP_SHEET_PEEK_STOP);
  });
});

describe('mapSheetStopReducer', () => {
  const opened = { stop: MAP_SHEET_HALF_STOP, toolReturn: null };

  it('takes a settled detent as the stop and ignores one still moving', () => {
    const moving = mapSheetStopReducer(opened, { type: 'detent', index: 2, isStable: false });
    expect(moving.stop).toBe(MAP_SHEET_HALF_STOP);
    const settled = mapSheetStopReducer(moving, { type: 'detent', index: 2, isStable: true });
    expect(settled.stop).toBe(MAP_SHEET_FULL_STOP);
  });

  it('ignores a detent index outside the three stops', () => {
    expect(mapSheetStopReducer(opened, { type: 'detent', index: 3, isStable: true })).toBe(opened);
    expect(mapSheetStopReducer(opened, { type: 'detent', index: -1, isStable: true })).toBe(opened);
  });

  it('returns a tool to the stop it recorded on entry, after the sheet moved meanwhile', () => {
    const entered = mapSheetStopReducer(
      { stop: MAP_SHEET_FULL_STOP, toolReturn: null },
      { type: 'toolEntered' }
    );
    const moved = mapSheetStopReducer(entered, { type: 'detent', index: 0, isStable: true });
    const left = mapSheetStopReducer(moved, { type: 'toolLeft' });
    expect(left).toEqual({ stop: MAP_SHEET_FULL_STOP, toolReturn: null });
  });

  it('keeps the first recorded stop when a tool is entered twice', () => {
    const entered = mapSheetStopReducer(
      { stop: MAP_SHEET_PEEK_STOP, toolReturn: null },
      { type: 'toolEntered' }
    );
    const moved = mapSheetStopReducer(entered, { type: 'detent', index: 2, isStable: true });
    const again = mapSheetStopReducer(moved, { type: 'toolEntered' });
    expect(mapSheetStopReducer(again, { type: 'toolLeft' }).stop).toBe(MAP_SHEET_PEEK_STOP);
  });

  it('leaves the stop alone when a tool is left without having been entered', () => {
    expect(mapSheetStopReducer(opened, { type: 'toolLeft' })).toBe(opened);
  });
});

describe('useMapSheetStop', () => {
  it('opens at Half and follows the settled detent', () => {
    const { result } = renderHook(() => useMapSheetStop(KEY));
    expect(result.current.stop).toBe(MAP_SHEET_HALF_STOP);
    act(() => result.current.onDetentChanged({ index: 0, isStable: false }));
    expect(result.current.stop).toBe(MAP_SHEET_HALF_STOP);
    act(() => result.current.onDetentChanged({ index: 0, isStable: true }));
    expect(result.current.stop).toBe(MAP_SHEET_PEEK_STOP);
  });

  it("sends the map's expand button to Peek through the screen's presenter", () => {
    const present = jest.fn();
    const { result } = renderHook(() => useMapSheetStop(KEY, present));
    act(() => result.current.expandMap());
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith(MAP_SHEET_PEEK_STOP);
    expect(result.current.stop).toBe(MAP_SHEET_PEEK_STOP);
  });

  it('asks for nothing when the sheet already rests at the stop requested', () => {
    const present = jest.fn();
    const { result } = renderHook(() => useMapSheetStop(KEY, present));
    act(() => result.current.request(MAP_SHEET_HALF_STOP));
    expect(present).not.toHaveBeenCalled();
  });

  it("reaches the screen's presenter from the sheet, which registers none", () => {
    const present = jest.fn();
    renderHook(() => useMapSheetStop(KEY, present));
    const sheet = renderHook(() => useMapSheetStop(KEY));
    act(() => sheet.result.current.tapHandle());
    expect(present).toHaveBeenCalledWith(MAP_SHEET_FULL_STOP);
  });

  it('drops the presenter and the stop when the screen goes', () => {
    const present = jest.fn();
    const screenHook = renderHook(() => useMapSheetStop(KEY, present));
    act(() => screenHook.result.current.onDetentChanged({ index: 2, isStable: true }));
    screenHook.unmount();
    const { result } = renderHook(() => useMapSheetStop(KEY));
    expect(result.current.stop).toBe(MAP_SHEET_HALF_STOP);
    act(() => result.current.expandMap());
    expect(present).not.toHaveBeenCalled();
  });

  it('restores the stop a tool found on Cancel', () => {
    const present = jest.fn();
    const { result } = renderHook(() => useMapSheetStop(KEY, present));
    act(() => result.current.onDetentChanged({ index: 2, isStable: true }));
    act(() => result.current.enterTool());
    act(() => result.current.onDetentChanged({ index: 0, isStable: true }));
    act(() => result.current.leaveTool());
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith(MAP_SHEET_FULL_STOP);
    expect(result.current.stop).toBe(MAP_SHEET_FULL_STOP);
  });

  it('keeps one sheet’s stop apart from another’s', () => {
    const pear = renderHook(() => useMapSheetStop(KEY));
    const plum = renderHook(() => useMapSheetStop('orchard:plum'));
    act(() => pear.result.current.onDetentChanged({ index: 2, isStable: true }));
    expect(plum.result.current.stop).toBe(MAP_SHEET_HALF_STOP);
  });
});

describe('MapSheetHandle', () => {
  function element() {
    return screen.getByTestId('map-sheet-handle');
  }

  it('reads the stop as an adjustable value named for what it sizes', async () => {
    await render(<MapSheetHandle sheetKey={KEY} drawn />);
    expect(element().props.accessibilityRole).toBe('adjustable');
    expect(element().props.accessibilityLabel).toBe('Map and details size');
    expect(element().props.accessibilityValue).toEqual({ text: 'Half' });
  });

  it('moves the sheet once per increment and once per decrement', async () => {
    const present = jest.fn();
    renderHook(() => useMapSheetStop(KEY, present));
    await render(<MapSheetHandle sheetKey={KEY} drawn />);
    fireEvent(element(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenLastCalledWith(MAP_SHEET_FULL_STOP);
    expect(element().props.accessibilityValue).toEqual({ text: 'Full' });
    fireEvent(element(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(present).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenLastCalledWith(MAP_SHEET_HALF_STOP);
  });

  it('asks for nothing on an increment at Full', async () => {
    const present = jest.fn();
    const screenHook = renderHook(() => useMapSheetStop(KEY, present));
    act(() => screenHook.result.current.onDetentChanged({ index: 2, isStable: true }));
    await render(<MapSheetHandle sheetKey={KEY} drawn />);
    fireEvent(element(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(present).not.toHaveBeenCalled();
  });

  it('steps up on a tap and wraps Full to Peek', async () => {
    const present = jest.fn();
    const screenHook = renderHook(() => useMapSheetStop(KEY, present));
    act(() => screenHook.result.current.onDetentChanged({ index: 2, isStable: true }));
    await render(<MapSheetHandle sheetKey={KEY} drawn />);
    fireEvent.press(element());
    expect(present).toHaveBeenCalledWith(MAP_SHEET_PEEK_STOP);
  });

  it('draws the bar only where the platform draws no grabber of its own', async () => {
    await render(<MapSheetHandle sheetKey={KEY} drawn={false} />);
    expect(screen.queryByTestId('map-sheet-handle-bar')).toBeNull();
    expect(element().props.accessibilityRole).toBe('adjustable');
  });
});
