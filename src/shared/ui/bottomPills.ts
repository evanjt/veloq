/**
 * What the bottom pill stack needs from layout: how tall each shown pill came out, and how far
 * up the screen in front draws over its foot.
 *
 * Only layout knows a pill's height, since its text wraps with the text size, and only the screen
 * knows what it floats over its foot, so both report here and `BottomPillStack` reads them.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

/** The pills the stack places, nearest the bottom first: the control in reach sits lowest. */
export const BOTTOM_PILL_ORDER = ['recording', 'tour'] as const;

export type BottomPillKey = (typeof BOTTOM_PILL_ORDER)[number];

interface BottomPills {
  /** Each shown pill's drawn height. A pill that draws nothing has no entry. */
  heights: Partial<Record<BottomPillKey, number>>;
  /** How far each floating control over the screen's foot reaches, by the control's name. */
  covers: Record<string, number>;
  /** Records a pill's height as it lays out, and drops it with `null` or 0 as it goes. */
  setHeight(pill: BottomPillKey, height: number | null): void;
  /** Records a control's cover while it shows, and drops it with `null` as it hides or goes. */
  setCover(control: string, cover: number | null): void;
}

export const useBottomPills = create<BottomPills>((set) => ({
  heights: {},
  covers: {},
  setHeight: (pill, height) =>
    set((state) => {
      const shown = height ? height : null;
      if ((state.heights[pill] ?? null) === shown) return state;
      const heights = { ...state.heights };
      if (shown === null) delete heights[pill];
      else heights[pill] = shown;
      return { heights };
    }),
  setCover: (control, cover) =>
    set((state) => {
      if ((state.covers[control] ?? null) === cover) return state;
      const covers = { ...state.covers };
      if (cover === null) delete covers[control];
      else covers[control] = cover;
      return { covers };
    }),
}));

/** The tallest cover reported, or 0 when nothing floats over the screen's foot. */
export function footCover(covers: Record<string, number>): number {
  return Object.values(covers).reduce((tallest, cover) => Math.max(tallest, cover), 0);
}

/** Reports a control's cover while `cover` is a number, and drops it when it is `null` or the control goes. */
export function useFootCover(control: string, cover: number | null): void {
  useEffect(() => {
    const { setCover } = useBottomPills.getState();
    setCover(control, cover);
    return () => setCover(control, null);
  }, [control, cover]);
}
