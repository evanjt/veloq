// The one registry of keyboard shortcuts. The shell and each page register the
// keys they wire, and the dialog the `?` key opens lists what is registered,
// so the list cannot name a key nothing handles or leave one out. Also whether
// the single-key shortcuts are on, kept in this browser.

import type { ParseKeys } from 'i18next';
import { useCallback, useState, useSyncExternalStore } from 'react';

export type Shortcut = {
  /** The keys to press, in the order they are pressed; shown one after another. */
  keys: readonly string[];
  /** The translation key naming what the keys do. */
  label: ParseKeys;
  /** The heading the overlay lists it under. */
  group: 'shell' | 'page';
};

let held: readonly Shortcut[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly Shortcut[]) {
  held = next;
  for (const listener of listeners) listener();
}

/** Register a shortcut; the returned function removes it. */
export function registerShortcut(shortcut: Shortcut): () => void {
  const entry = { ...shortcut };
  publish([...held, entry]);
  return () => publish(held.filter((candidate) => candidate !== entry));
}

/** Register several at once. */
export function registerShortcuts(shortcuts: readonly Shortcut[]): () => void {
  const offs = shortcuts.map(registerShortcut);
  return () => offs.forEach((off) => off());
}

/** Every shortcut registered now, in registration order. */
export function listShortcuts(): readonly Shortcut[] {
  return held;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The registered shortcuts, redrawn as pages register and unregister theirs. */
export function useShortcuts(): readonly Shortcut[] {
  return useSyncExternalStore(subscribe, listShortcuts, listShortcuts);
}

/** Where the browser keeps whether the single-key shortcuts are on. */
export const SHORTCUTS_KEY = 'veloq-connect-shortcuts';

/** Single-key shortcuts are on unless the kept text says they are off. */
export function parseShortcutsSetting(raw: string | null): boolean {
  return raw !== 'off';
}

function readShortcutsOn(): boolean {
  try {
    return parseShortcutsSetting(localStorage.getItem(SHORTCUTS_KEY));
  } catch {
    return true;
  }
}

/** Whether single-key shortcuts are on, and the setter that keeps the choice in this browser. */
export function useSingleKeyShortcuts(): [on: boolean, set: (on: boolean) => void] {
  const [on, setOn] = useState(readShortcutsOn);
  const set = useCallback((next: boolean) => {
    try {
      localStorage.setItem(SHORTCUTS_KEY, next ? 'on' : 'off');
    } catch {
      // Storage that is blocked leaves the choice for this visit only.
    }
    setOn(next);
  }, []);
  return [on, set];
}
