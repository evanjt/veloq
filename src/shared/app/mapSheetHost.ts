/**
 * The state a map detail screen's map and its sheet both read, one entry per host screen.
 *
 * A host is a detail screen that owns its map and its sheet through a nested stack, keyed by
 * its kind and id (`route:<id>`). Its entry holds the card stack the sheet shows, the root card
 * first, and each card keeps its own shared state (the selected attempt, the range, the sport on
 * show, the line the chart colours), which the card's kind defines. Nothing here is an engine
 * fact: the map and the sheet each read the engine's screen data themselves.
 *
 * The host opens its entry when it mounts and drops it when it unmounts, so a screen opened again
 * starts on its root card with nothing picked. The same subject open twice in the stack shares
 * one entry, which stays until the last of them goes.
 */
import { create } from 'zustand';

export type MapSheetKind = 'route' | 'section' | 'activity';

/** A card in a host's sheet: its subject and the state the map and the card share. */
export interface MapSheetCard {
  kind: MapSheetKind;
  id: string;
  state: Readonly<Record<string, unknown>>;
}

export interface MapSheetHostEntry {
  /** The cards the sheet holds, the root first and the one on show last. */
  cards: readonly MapSheetCard[];
  /** How many mounted screens hold this entry. */
  holders: number;
}

export type MapSheetHosts = Readonly<Record<string, MapSheetHostEntry>>;

/** The key a host's entry is held under. */
export function mapSheetHostKey(kind: MapSheetKind, id: string): string {
  return `${kind}:${id}`;
}

/** The hosts with this one opened: a root card of its own subject, or one more holder. */
export function openMapSheetHost(
  hosts: MapSheetHosts,
  kind: MapSheetKind,
  id: string
): MapSheetHosts {
  const key = mapSheetHostKey(kind, id);
  const entry = hosts[key];
  if (entry) return { ...hosts, [key]: { ...entry, holders: entry.holders + 1 } };
  return { ...hosts, [key]: { cards: [{ kind, id, state: {} }], holders: 1 } };
}

/** The hosts with one holder of this one gone, and the entry with it once none is left. */
export function closeMapSheetHost(hosts: MapSheetHosts, key: string): MapSheetHosts {
  const entry = hosts[key];
  if (!entry) return hosts;
  if (entry.holders > 1) return { ...hosts, [key]: { ...entry, holders: entry.holders - 1 } };
  const rest = { ...hosts };
  delete rest[key];
  return rest;
}

/**
 * The hosts with the top card's state merged with `patch`. A patch that changes no field returns
 * the same object, so a reader selecting a field renders only when that field moves.
 */
export function patchTopCard(
  hosts: MapSheetHosts,
  key: string,
  patch: Readonly<Record<string, unknown>>
): MapSheetHosts {
  const entry = hosts[key];
  const top = entry?.cards[entry.cards.length - 1];
  if (!entry || !top) return hosts;
  if (Object.entries(patch).every(([field, value]) => Object.is(top.state[field], value))) {
    return hosts;
  }
  const cards = [...entry.cards.slice(0, -1), { ...top, state: { ...top.state, ...patch } }];
  return { ...hosts, [key]: { ...entry, cards } };
}

/** The card on show in a host's sheet, or undefined for a host not open. */
export function topCard(hosts: MapSheetHosts, key: string): MapSheetCard | undefined {
  const cards = hosts[key]?.cards;
  return cards?.[cards.length - 1];
}

/** Every open host's entry, by its key. */
export const useMapSheetHosts = create<{ hosts: MapSheetHosts }>(() => ({ hosts: {} }));

export function openHost(kind: MapSheetKind, id: string): string {
  useMapSheetHosts.setState((store) => ({ hosts: openMapSheetHost(store.hosts, kind, id) }));
  return mapSheetHostKey(kind, id);
}

export function closeHost(key: string): void {
  useMapSheetHosts.setState((store) => ({ hosts: closeMapSheetHost(store.hosts, key) }));
}

/** Merges `patch` into the state of the card on show in a host's sheet. */
export function patchHostTopCard(key: string, patch: Readonly<Record<string, unknown>>): void {
  const { hosts } = useMapSheetHosts.getState();
  const next = patchTopCard(hosts, key, patch);
  if (next !== hosts) useMapSheetHosts.setState({ hosts: next });
}

/** One field of the state of the card on show, rendering its reader only when it changes. */
export function useHostTopCardField<T>(key: string, field: string): T | undefined {
  return useMapSheetHosts((store) => topCard(store.hosts, key)?.state[field] as T | undefined);
}

/** How many cards a host's sheet holds, 0 for a host not open. */
export function useHostCardCount(key: string): number {
  return useMapSheetHosts((store) => store.hosts[key]?.cards.length ?? 0);
}
