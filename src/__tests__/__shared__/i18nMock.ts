/**
 * `react-i18next` for suites that assert on translation keys rather than on
 * text. Each spreads the real module, so `Trans`, `initReactI18next` and the
 * rest are still there for anything else in the graph.
 *
 *   jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
 *
 * A suite that renders real text initialises i18n and mocks nothing.
 */

type Values = Record<string, unknown>;

function withT(t: (key: string, arg?: unknown) => unknown) {
  return { ...jest.requireActual('react-i18next'), useTranslation: () => ({ t }) };
}

/** `t` answers the key alone. */
export function keysOnly() {
  return withT((key) => key);
}

/** `t` answers the key, then the interpolation values as JSON when there are any. */
export function keysWithValues() {
  return withT((key, values) => (values ? `${key}:${JSON.stringify(values as Values)}` : key));
}

/** `t` answers a string default where the caller gives one, and the key otherwise. */
export function fallbackOrKey() {
  return withT((key, fallback) => (typeof fallback === 'string' ? fallback : key));
}
