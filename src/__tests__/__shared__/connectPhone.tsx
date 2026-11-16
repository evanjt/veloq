// A stand-in phone for the connect page's tests: a query client over a
// transport that lists every method and answers each ask from `handler`, and a
// wrapper that gives a page under test that client in context. A page under
// test reads through the real query layer, so what is tested is the page and
// the layer together.

import type { ReactElement } from 'react';

import { QueryClient, type Transport } from '../../../web/connect/query';
import { QueryProvider } from '../../../web/connect/useRead';

export type Call = { method: string; params: object };

const EVERYTHING = { includes: () => true } as unknown as readonly string[];

export function fakePhone(
  handler: (method: string, params: object) => unknown,
  methods: readonly string[] = EVERYTHING
) {
  const calls: Call[] = [];
  const transport: Transport = {
    methods: () => methods,
    ask: async (method, params) => {
      calls.push({ method, params });
      return handler(method, params);
    },
  };
  const queries = new QueryClient(transport);
  return {
    queries,
    calls,
    /** The calls of one method, in order. */
    callsOf: (method: string) => calls.filter((call) => call.method === method),
    wrap: (node: ReactElement) => <QueryProvider client={queries}>{node}</QueryProvider>,
  };
}
