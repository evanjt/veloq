/**
 * The credit a map detail screen's map hands to its sheet, one entry per host key.
 *
 * Where a sheet covers the map's foot, the credit is a line inside the sheet's top rather than a
 * bar over the map, so it rides the sheet frame by frame. The map knows the text and the sheet
 * draws it: the map writes here and the sheet's credit line reads. Nothing here is persisted.
 */
import { create } from 'zustand';

interface MapSheetCreditState {
  credits: Readonly<Record<string, string>>;
  set: (hostKey: string, text: string) => void;
  clear: (hostKey: string) => void;
}

export const useMapSheetCreditStore = create<MapSheetCreditState>((set) => ({
  credits: {},
  set: (hostKey, text) =>
    set((state) =>
      state.credits[hostKey] === text ? state : { credits: { ...state.credits, [hostKey]: text } }
    ),
  clear: (hostKey) =>
    set((state) => {
      if (!(hostKey in state.credits)) return state;
      const { [hostKey]: _gone, ...rest } = state.credits;
      return { credits: rest };
    }),
}));

/** The credit text the map has published for a host, or an empty string. */
export function useMapSheetCredit(hostKey: string): string {
  return useMapSheetCreditStore((state) => state.credits[hostKey] ?? '');
}
