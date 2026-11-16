// Measuring: the width of the element a chart sits in, kept current by a
// ResizeObserver, and the width of a string in the chart's own font.

import { useEffect, useMemo, useState, type RefObject } from 'react';

import { TEXT_PX, estimateWidth, type Measure } from './scale';

/** The width a chart is drawn at until its element has been measured, and where there is no browser. */
export const FALLBACK_WIDTH = 640;

/**
 * The width of `ref`'s element in pixels, read at mount and again whenever it
 * changes. `fixed` overrides the measurement, for a drawing made without a
 * browser.
 */
export function useWidth(ref: RefObject<Element | null>, fixed?: number): number {
  const [width, setWidth] = useState(fixed ?? FALLBACK_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (fixed !== undefined || !element || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, fixed]);
  return fixed ?? width;
}

type TextContext = { font: string; measureText: (text: string) => { width: number } };

/**
 * A measure over `ctx` in the chart's font, or null when the canvas did not
 * take the font (it then keeps its 10 px default and every width is a fifth
 * too small). The canvas has proportional digits and the svg draws tabular
 * ones, so each digit counts as the widest.
 */
export function canvasMeasure(ctx: TextContext, family: string): Measure | null {
  ctx.font = `${TEXT_PX}px ${family}`;
  if (!ctx.font.includes(`${TEXT_PX}px`)) return null;
  const digit = Math.max(...[...'0123456789'].map((d) => ctx.measureText(d).width));
  return (text) => {
    let run = '';
    let digits = 0;
    for (const char of text) {
      if (char >= '0' && char <= '9') digits++;
      else run += char;
    }
    return digits * digit + (run ? ctx.measureText(run).width : 0);
  };
}

/**
 * Measures a string with the canvas in the font the element draws in, so a
 * margin follows the label it holds. Falls back to the estimate where there is
 * no canvas.
 */
export function useMeasure(ref: RefObject<Element | null>): Measure {
  const [family, setFamily] = useState('');
  useEffect(() => {
    const element = ref.current;
    if (element && typeof getComputedStyle === 'function') {
      setFamily(getComputedStyle(element).fontFamily);
    }
  }, [ref]);
  return useMemo(() => {
    if (!family || typeof document === 'undefined') return estimateWidth;
    const ctx = document.createElement('canvas').getContext('2d');
    return (ctx && canvasMeasure(ctx, family)) || estimateWidth;
  }, [family]);
}
