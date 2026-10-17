/**
 * The stop a map screen's data sheet rests at, and the one way to move it.
 *
 * The native sheet takes its detent only as it opens (`sheetInitialDetentIndex`), and no
 * version of the stack exposes a setter afterwards, so a move is the screen presenting the sheet
 * again at the stop asked for. The screen registers that presenter; the map's expand button, the
 * handle, the screen reader's adjust gesture and a tool's return all ask through here. The stop
 * itself is the last detent the sheet settled at, so a drag the athlete makes is what a tool
 * returns to.
 *
 * The stops are the indices of `sheetStops`, low to high.
 */
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

export const MAP_SHEET_PEEK_STOP = 0;
export const MAP_SHEET_HALF_STOP = 1;
export const MAP_SHEET_FULL_STOP = 2;

/** The stop the sheet opens at, matching `mapSheetScreenOptions`. */
const OPENING_STOP = MAP_SHEET_HALF_STOP;

/** A stop's name, as the screen reader reads it under `maps.sheetStop`. */
export function mapSheetStopName(stop: number): 'peek' | 'half' | 'full' {
  if (stop <= MAP_SHEET_PEEK_STOP) return 'peek';
  return stop >= MAP_SHEET_FULL_STOP ? 'full' : 'half';
}

/**
 * `next` is the handle tap, which steps up and wraps Full to Peek. `up` and `down` are a
 * slider's increment and decrement, which stop at either end.
 */
export type StopDirection = 'next' | 'up' | 'down';

export function nextStop(stop: number, direction: StopDirection): number {
  if (direction === 'next') return stop >= MAP_SHEET_FULL_STOP ? MAP_SHEET_PEEK_STOP : stop + 1;
  if (direction === 'up') return Math.min(stop + 1, MAP_SHEET_FULL_STOP);
  return Math.max(stop - 1, MAP_SHEET_PEEK_STOP);
}

export interface MapSheetStopState {
  stop: number;
  /** The stop a tool found on entry, which leaving it restores, or null outside a tool. */
  toolReturn: number | null;
}

export type MapSheetStopAction =
  | { type: 'detent'; index: number; isStable: boolean }
  | { type: 'requested'; stop: number }
  | { type: 'toolEntered' }
  | { type: 'toolLeft' };

const OPENED: MapSheetStopState = { stop: OPENING_STOP, toolReturn: null };

function isStop(index: number): boolean {
  return Number.isInteger(index) && index >= MAP_SHEET_PEEK_STOP && index <= MAP_SHEET_FULL_STOP;
}

/**
 * A detent still moving is not a stop, so only a settled one is taken. A second tool entry keeps
 * the stop the first recorded, since the sheet may have moved for the tool in between.
 */
export function mapSheetStopReducer(
  state: MapSheetStopState,
  action: MapSheetStopAction
): MapSheetStopState {
  switch (action.type) {
    case 'detent':
      if (!action.isStable || !isStop(action.index) || action.index === state.stop) return state;
      return { ...state, stop: action.index };
    case 'requested':
      if (!isStop(action.stop) || action.stop === state.stop) return state;
      return { ...state, stop: action.stop };
    case 'toolEntered':
      if (state.toolReturn !== null) return state;
      return { ...state, toolReturn: state.stop };
    case 'toolLeft':
      if (state.toolReturn === null) return state;
      return { stop: state.toolReturn, toolReturn: null };
  }
  return state;
}

/** Presents the sheet again resting at `stop`. */
export type MapSheetPresenter = (stop: number) => void;

interface MapSheetStops {
  sheets: Record<string, MapSheetStopState>;
  presenters: Record<string, MapSheetPresenter>;
}

/** Every open map sheet's stop and its screen's presenter, by the sheet's key. */
export const useMapSheetStops = create<MapSheetStops>(() => ({ sheets: {}, presenters: {} }));

function stateOf(key: string): MapSheetStopState {
  return useMapSheetStops.getState().sheets[key] ?? OPENED;
}

/** Applies an action to one sheet and presents it again when its stop changed. */
function dispatch(key: string, action: MapSheetStopAction, present: boolean): void {
  const before = stateOf(key);
  const after = mapSheetStopReducer(before, action);
  if (after === before) return;
  useMapSheetStops.setState((store) => ({ sheets: { ...store.sheets, [key]: after } }));
  if (present && after.stop !== before.stop)
    useMapSheetStops.getState().presenters[key]?.(after.stop);
}

export interface MapSheetStop {
  /** The stop the sheet rests at. */
  stop: number;
  /** The sheet's `onSheetDetentChanged`, taking the stop it settled at. */
  onDetentChanged(event: { index: number; isStable: boolean }): void;
  /** Moves the sheet to a stop, and does nothing when it already rests there. */
  request(stop: number): void;
  /** A slider's increment or decrement, or the handle's step. */
  step(direction: StopDirection): void;
  /** The map's expand button: the sheet goes down to Peek. */
  expandMap(): void;
  /** A tap on the handle: one stop up, Full wrapping to Peek. */
  tapHandle(): void;
  /** Records the stop as a tool opens. */
  enterTool(): void;
  /** Returns the sheet to the stop the tool recorded, on Cancel or Save alike. */
  leaveTool(): void;
}

/**
 * One map sheet's stop, by a key the screen and its sheet route share, such as the section id.
 *
 * The screen passes `present`, which registers it for the key while the screen is mounted and
 * drops the sheet's stop when the screen goes. The sheet's own content passes none and reaches the
 * screen's presenter through the key.
 */
export function useMapSheetStop(key: string, present?: MapSheetPresenter): MapSheetStop {
  const stop = useMapSheetStops((store) => (store.sheets[key] ?? OPENED).stop);

  useEffect(() => {
    if (!present) return undefined;
    useMapSheetStops.setState((store) => ({ presenters: { ...store.presenters, [key]: present } }));
    return () =>
      useMapSheetStops.setState((store) => {
        const presenters = { ...store.presenters };
        const sheets = { ...store.sheets };
        delete presenters[key];
        delete sheets[key];
        return { presenters, sheets };
      });
  }, [key, present]);

  const onDetentChanged = useCallback(
    (event: { index: number; isStable: boolean }) =>
      dispatch(key, { type: 'detent', index: event.index, isStable: event.isStable }, false),
    [key]
  );
  const request = useCallback(
    (target: number) => dispatch(key, { type: 'requested', stop: target }, true),
    [key]
  );
  const step = useCallback(
    (direction: StopDirection) => request(nextStop(stateOf(key).stop, direction)),
    [key, request]
  );
  const expandMap = useCallback(() => request(MAP_SHEET_PEEK_STOP), [request]);
  const tapHandle = useCallback(() => step('next'), [step]);
  const enterTool = useCallback(() => dispatch(key, { type: 'toolEntered' }, false), [key]);
  const leaveTool = useCallback(() => dispatch(key, { type: 'toolLeft' }, true), [key]);

  return { stop, onDetentChanged, request, step, expandMap, tapHandle, enterTool, leaveTool };
}
