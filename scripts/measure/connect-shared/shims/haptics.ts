// A browser has no haptic engine.
export function selection(): void {}
export function light(): void {}
export function medium(): void {}
export function success(): void {}
export function onPullRefresh<Args extends unknown[], Result>(fn: (...args: Args) => Result) {
  return fn;
}
