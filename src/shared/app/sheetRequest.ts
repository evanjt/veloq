import { useCallback, useEffect, useMemo, useRef } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';

export type SheetResult<R> = { kind: 'selected'; value: R } | { kind: 'cancelled' };

interface Pending {
  input: unknown;
  settle: (result: SheetResult<unknown>) => void;
}

// Input and result stay in memory: a route param is a string, and an object input needs no encoding.
const pending = new Map<string, Pending>();
let counter = 0;

function settle(id: string, result: SheetResult<unknown>): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.settle(result);
  return true;
}

export function openSheet<I, R>(route: string, input: I): Promise<SheetResult<R>> {
  return openSheetWithId<I, R>(route, input).result;
}

function openSheetWithId<I, R>(
  route: string,
  input: I
): { id: string; result: Promise<SheetResult<R>> } {
  counter += 1;
  const id = `sheet-${counter}`;
  const result = new Promise<SheetResult<R>>((resolve) => {
    pending.set(id, { input, settle: resolve as Pending['settle'] });
  });
  router.push({ pathname: route, params: { request: id } } as Href);
  return { id, result };
}

/** A caller's opener. Every sheet it opened and left unanswered is cancelled when the caller unmounts. */
export function useSheetOpener(): <I, R>(route: string, input: I) => Promise<SheetResult<R>> {
  const opened = useRef(new Set<string>());
  useEffect(() => {
    const ids = opened.current;
    return () => {
      for (const id of ids) settle(id, { kind: 'cancelled' });
      ids.clear();
    };
  }, []);
  return useCallback(<I, R>(route: string, input: I) => {
    const { id, result } = openSheetWithId<I, R>(route, input);
    opened.current.add(id);
    return result.finally(() => opened.current.delete(id));
  }, []);
}

export interface SheetRequest<I, R> {
  /** Undefined when the request is unknown, for example after a process restart. */
  input: I | undefined;
  missing: boolean;
  /** Hands the caller its value and dismisses the sheet. Later calls are ignored. */
  resolve: (value: R) => void;
}

export function useSheetRequest<I, R>(): SheetRequest<I, R> {
  const { request } = useLocalSearchParams<{ request?: string }>();
  // Read once per request so the input outlives the entry that resolving removes.
  const held = useMemo(() => (request ? pending.get(request) : undefined), [request]);
  const missing = !held;

  useEffect(() => {
    if (missing) router.back();
  }, [missing]);

  useEffect(() => {
    if (!request) return undefined;
    return () => {
      settle(request, { kind: 'cancelled' });
    };
  }, [request]);

  const resolve = useCallback(
    (value: R) => {
      if (request && settle(request, { kind: 'selected', value })) router.back();
    },
    [request]
  );

  return { input: held?.input as I | undefined, missing, resolve };
}
