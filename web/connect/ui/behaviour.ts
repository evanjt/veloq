// The keyboard, timing and storage rules the kit's overlays share, kept as
// plain functions so each is tested without a browser.

export const TOOLTIP_DELAY_MS = 400;
export const TOAST_LIFETIME_MS = 6000;
/** A toast that offers an undo stays longer, so the button can be reached. */
export const UNDO_TOAST_LIFETIME_MS = 10_000;

export type Focusable = { focus(): void };

/**
 * Where Tab goes inside a dialog: wraps from the last control to the first and
 * from the first back to the last, and pulls focus in when it sits outside.
 * Returns the control to focus, or null when the browser's own step stays inside.
 */
export function trapTarget<T extends Focusable>(
  controls: readonly T[],
  active: unknown,
  backwards: boolean
): T | null {
  if (controls.length === 0) return null;
  const at = controls.findIndex((control) => control === active);
  if (at === -1) return (backwards ? controls[controls.length - 1] : controls[0]) ?? null;
  if (backwards && at === 0) return controls[controls.length - 1] ?? null;
  if (!backwards && at === controls.length - 1) return controls[0] ?? null;
  return null;
}

export type DialogKey = { key: string; shiftKey: boolean; preventDefault(): void };

/** Applies Escape and Tab for a dialog; returns true when the key was handled. */
export function dialogKey<T extends Focusable>(
  event: DialogKey,
  controls: readonly T[],
  active: unknown,
  close: () => void
): boolean {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return true;
  }
  if (event.key !== 'Tab') return false;
  if (controls.length === 0) {
    event.preventDefault();
    return true;
  }
  const target = trapTarget(controls, active, event.shiftKey);
  if (target) {
    event.preventDefault();
    target.focus();
  }
  return true;
}

/** The enabled item a key moves a menu or tab list to; null when the key is not a movement. */
export function stepIndex(
  key: string,
  current: number,
  count: number,
  vertical = true
): number | null {
  if (count === 0) return null;
  const next = vertical ? 'ArrowDown' : 'ArrowRight';
  const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
  if (key === next) return (current + 1) % count;
  if (key === previous) return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export type ToastEntry = { id: number; message: string; undo?: { label: string; run: () => void } };

/** How long a toast stays when nothing holds it. */
export const toastLifetime = (toast: ToastEntry): number =>
  toast.undo ? UNDO_TOAST_LIFETIME_MS : TOAST_LIFETIME_MS;

export function pushToast(list: readonly ToastEntry[], entry: ToastEntry): ToastEntry[] {
  return [...list.filter((held) => held.id !== entry.id), entry];
}

export function dismissToast(list: readonly ToastEntry[], id: number): ToastEntry[] {
  return list.filter((held) => held.id !== id);
}

/** Runs a toast's undo once and removes it, so a second press does nothing. */
export function undoToast(list: readonly ToastEntry[], id: number): ToastEntry[] {
  const entry = list.find((held) => held.id === id);
  if (!entry) return [...list];
  entry.undo?.run();
  return dismissToast(list, id);
}

export type PaneStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function loadWidth(
  storage: PaneStorage | null,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  try {
    const raw = storage?.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clampWidth(value, min, max) : fallback;
  } catch {
    return fallback;
  }
}

export function saveWidth(storage: PaneStorage | null, key: string, width: number | null): void {
  try {
    if (width === null) storage?.removeItem(key);
    else storage?.setItem(key, String(width));
  } catch {
    // Storage can be full or blocked; the width then lasts for the page only.
  }
}

export function browserStorage(): PaneStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The width a drag reaches: where it began plus how far the pointer has moved. */
export function draggedWidth(
  start: number,
  startX: number,
  x: number,
  min: number,
  max: number
): number {
  return clampWidth(start + (x - startX), min, max);
}

/** The width a key on the divider reaches, or null for another key. */
export function dividerKey(
  key: string,
  width: number,
  step: number,
  min: number,
  max: number
): number | null {
  if (key === 'ArrowLeft') return clampWidth(width - step, min, max);
  if (key === 'ArrowRight') return clampWidth(width + step, min, max);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}
