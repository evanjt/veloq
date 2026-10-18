/**
 * The state a map detail screen's map and its sheet both read, one entry per host screen.
 *
 * A host is a detail screen that owns its map and its sheet through a nested stack, keyed by
 * its kind and id (`route:<id>`). Its entry holds the card stack the sheet shows, the root card
 * first, and each card keeps its own shared state (the selected attempt, the range, the sport on
 * show, the line the chart colours), which the card's kind defines. Nothing here is an engine
 * fact: the map and the sheet each read the engine's screen data themselves.
 *
 * A row in a card opens its subject as another card pushed on top, and popping it returns to the
 * card below with that card's state as it was left. The root card is never popped: leaving it is
 * leaving the screen.
 *
 * The host opens its entry when it mounts and drops it when it unmounts, so a screen opened again
 * starts on its root card with nothing picked. The same subject open twice in the stack shares
 * one entry, which stays until the last of them goes.
 */
import { useMemo } from 'react';
import { create } from 'zustand';

export type MapSheetKind = 'route' | 'section' | 'activity';

/**
 * What a card in a host's sheet shows: a detail subject, or a section's history or its laps,
 * which open from a section's card and so stay inside the sheet too.
 */
export type MapSheetCardKind = MapSheetKind | 'section-history' | 'section-laps';

/** What a card was opened with beyond its id, such as the activity a section was opened from. */
export type MapSheetCardParams = Readonly<Record<string, string | undefined>>;

/** A card in a host's sheet: its subject and the state the map and the card share. */
export interface MapSheetCard {
  kind: MapSheetCardKind;
  id: string;
  params: MapSheetCardParams;
  state: Readonly<Record<string, unknown>>;
}

/** A card to push: its subject, and its params when it has any. */
export interface MapSheetCardSubject {
  kind: MapSheetCardKind;
  id: string;
  params?: MapSheetCardParams;
}

const NO_PARAMS: MapSheetCardParams = {};

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
  return { ...hosts, [key]: { cards: [{ kind, id, params: NO_PARAMS, state: {} }], holders: 1 } };
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

/** The hosts with a card pushed on top of this host's stack, or the same hosts for one not open. */
export function pushCard(
  hosts: MapSheetHosts,
  key: string,
  subject: MapSheetCardSubject
): MapSheetHosts {
  const entry = hosts[key];
  if (!entry) return hosts;
  const card: MapSheetCard = {
    kind: subject.kind,
    id: subject.id,
    params: subject.params ?? NO_PARAMS,
    state: {},
  };
  return { ...hosts, [key]: { ...entry, cards: [...entry.cards, card] } };
}

/** The hosts with this host's top card popped. The root card stays, so a lone root changes nothing. */
export function popCard(hosts: MapSheetHosts, key: string): MapSheetHosts {
  const entry = hosts[key];
  if (!entry || entry.cards.length <= 1) return hosts;
  return { ...hosts, [key]: { ...entry, cards: entry.cards.slice(0, -1) } };
}

/**
 * The hosts with the state of the card at `index`, the root at 0, merged with `patch`. A patch
 * that changes no field, or names no card, returns the same object, so a reader selecting a
 * field renders only when that field moves.
 */
export function patchCard(
  hosts: MapSheetHosts,
  key: string,
  index: number,
  patch: Readonly<Record<string, unknown>>
): MapSheetHosts {
  const entry = hosts[key];
  const card = entry?.cards[index];
  if (!entry || !card) return hosts;
  if (Object.entries(patch).every(([field, value]) => Object.is(card.state[field], value))) {
    return hosts;
  }
  const cards = entry.cards.map((each, at) =>
    at === index ? { ...card, state: { ...card.state, ...patch } } : each
  );
  return { ...hosts, [key]: { ...entry, cards } };
}

/** The hosts with the top card's state merged with `patch`, as `patchCard` does. */
export function patchTopCard(
  hosts: MapSheetHosts,
  key: string,
  patch: Readonly<Record<string, unknown>>
): MapSheetHosts {
  const count = hosts[key]?.cards.length ?? 0;
  return count === 0 ? hosts : patchCard(hosts, key, count - 1, patch);
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

function updateHosts(update: (hosts: MapSheetHosts) => MapSheetHosts): void {
  const { hosts } = useMapSheetHosts.getState();
  const next = update(hosts);
  if (next !== hosts) useMapSheetHosts.setState({ hosts: next });
}

/** Pushes a card on top of a host's sheet. */
export function pushHostCard(key: string, subject: MapSheetCardSubject): void {
  updateHosts((hosts) => pushCard(hosts, key, subject));
}

/** Pops the top card of a host's sheet, unless it is the root. */
export function popHostCard(key: string): void {
  updateHosts((hosts) => popCard(hosts, key));
}

/** Merges `patch` into the state of the card at `index` in a host's sheet. */
export function patchHostCard(
  key: string,
  index: number,
  patch: Readonly<Record<string, unknown>>
): void {
  updateHosts((hosts) => patchCard(hosts, key, index, patch));
}

/** Merges `patch` into the state of the card on show in a host's sheet. */
export function patchHostTopCard(key: string, patch: Readonly<Record<string, unknown>>): void {
  updateHosts((hosts) => patchTopCard(hosts, key, patch));
}

/** One field of the state of the card on show, rendering its reader only when it changes. */
export function useHostTopCardField<T>(key: string, field: string): T | undefined {
  return useMapSheetHosts((store) => topCard(store.hosts, key)?.state[field] as T | undefined);
}

/** The cards a host's sheet holds, the root first, or none for a host not open. */
export function useHostCards(key: string): readonly MapSheetCard[] {
  return useMapSheetHosts((store) => store.hosts[key]?.cards ?? NO_CARDS);
}

const NO_CARDS: readonly MapSheetCard[] = [];

/** How many cards a host's sheet holds, 0 for a host not open. */
export function useHostCardCount(key: string): number {
  return useMapSheetHosts((store) => store.hosts[key]?.cards.length ?? 0);
}

/**
 * The subject of the card on show, its kind, id and params, and how deep in the stack it sits, or
 * null for a host not open. A write to a card's state does not render the reader.
 */
export function useHostTopCardSubject(key: string): {
  kind: MapSheetCardKind;
  id: string;
  params: MapSheetCardParams;
  depth: number;
} | null {
  const kind = useMapSheetHosts((store) => topCard(store.hosts, key)?.kind);
  const id = useMapSheetHosts((store) => topCard(store.hosts, key)?.id);
  const params = useMapSheetHosts((store) => topCard(store.hosts, key)?.params);
  const depth = useHostCardCount(key);
  return useMemo(
    () =>
      kind === undefined || id === undefined
        ? null
        : { kind, id, params: params ?? NO_PARAMS, depth },
    [kind, id, params, depth]
  );
}
