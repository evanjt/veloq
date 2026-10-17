/**
 * Scenario: a worklet is copied to the UI runtime with everything it captured.
 * The worklets runtime copies primitives, arrays, plain objects, functions and
 * a few built-ins, and throws on anything else, such as a `Date`. The throw
 * happens on the JS thread as the chart mounts and kills a release build, so a
 * chart whose points carry a date crashes the screen it is on.
 *
 * Expected behaviour: every worklet the shared chart gestures hand to the UI
 * runtime captures only values it can copy, whatever the chart's points hold.
 */

import { renderHook } from '@testing-library/react-native';
import { isSharedValue } from 'react-native-reanimated';

import { useChartGestures } from '@/shared/charts/useChartGestures';
import { capturePans } from '../__shared__/chartScrub';

const handedToUi: [string, unknown][] = [];

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  const recorded =
    (name: string) =>
    (...args: unknown[]) => {
      handedToUi.push([name, args[0]]);
      if (name === 'useAnimatedReaction') handedToUi.push([`${name} react`, args[1]]);
      return actual[name](...args);
    };
  return {
    ...actual,
    useDerivedValue: recorded('useDerivedValue'),
    useAnimatedReaction: recorded('useAnimatedReaction'),
    useAnimatedStyle: recorded('useAnimatedStyle'),
  };
});

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
}));

interface DatedPoint {
  date: Date;
  value: number;
}

const POINTS: DatedPoint[] = Array.from({ length: 6 }, (_, i) => ({
  date: new Date(Date.UTC(2031, 2, i + 1)),
  value: 40 + i,
}));

const COPYABLE_BUILT_INS = [Map, Set, RegExp, Error, ArrayBuffer];

/** Paths under `value` the worklets runtime cannot copy, as it would walk them. */
function uncopyable(value: unknown, path: string, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object') {
    if (typeof value !== 'function') return [];
    const closure = (value as { __closure?: unknown }).__closure;
    return closure === undefined ? [] : uncopyable(closure, `${path}.__closure`, seen);
  }
  if (seen.has(value)) return [];
  seen.add(value);
  if (isSharedValue(value)) return [];
  if (ArrayBuffer.isView(value) || COPYABLE_BUILT_INS.some((type) => value instanceof type)) {
    return [];
  }
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return [`${path} is a ${proto?.constructor?.name ?? 'class instance'}`];
  }
  return Object.entries(value).flatMap(([key, child]) => uncopyable(child, `${path}.${key}`, seen));
}

beforeEach(() => {
  handedToUi.length = 0;
});
afterEach(() => jest.restoreAllMocks());

describe('chart gesture worklets', () => {
  it('capture nothing the UI runtime cannot copy when the points carry dates', async () => {
    const pans = capturePans();
    await renderHook(() => useChartGestures({ data: POINTS, onSelect: jest.fn() }));

    const worklets: [string, unknown][] = [
      ...handedToUi,
      ...pans.flatMap((pan, i) =>
        Object.entries((pan as unknown as { handlers: Record<string, unknown> }).handlers)
          .filter(([, handler]) => typeof handler === 'function')
          .map(([name, handler]): [string, unknown] => [`pan ${i} ${name}`, handler])
      ),
    ];
    expect(worklets.some(([name]) => name === 'useDerivedValue')).toBe(true);

    const offenders = worklets.flatMap(([name, worklet]) => uncopyable(worklet, name));
    expect(offenders).toEqual([]);
  });
});
