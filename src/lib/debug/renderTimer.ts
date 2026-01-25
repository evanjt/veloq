/**
 * Debug utility to track component render timing and mount/unmount cycles.
 * Only logs in __DEV__ mode.
 */

const componentTimers: Map<string, number> = new Map();

export function logMount(componentName: string) {
  if (!__DEV__) return;
  const now = performance.now();
  componentTimers.set(componentName, now);
  console.log(`[MOUNT] ${componentName} @ ${now.toFixed(0)}ms`);
}

export function logUnmount(componentName: string) {
  if (!__DEV__) return;
  const mountTime = componentTimers.get(componentName);
  const now = performance.now();
  const lifespan = mountTime ? now - mountTime : 0;
  console.log(`[UNMOUNT] ${componentName} @ ${now.toFixed(0)}ms (lived ${lifespan.toFixed(0)}ms)`);
  componentTimers.delete(componentName);
}

export function logRender(componentName: string, reason?: string) {
  if (!__DEV__) return;
  const now = performance.now();
  console.log(`[RENDER] ${componentName} @ ${now.toFixed(0)}ms${reason ? ` - ${reason}` : ''}`);
}

export function logQueryStart(queryName: string) {
  if (!__DEV__) return;
  const now = performance.now();
  componentTimers.set(`query:${queryName}`, now);
  console.log(`[QUERY START] ${queryName} @ ${now.toFixed(0)}ms`);
}

export function logQueryEnd(queryName: string, status: 'success' | 'error' | 'settled') {
  if (!__DEV__) return;
  const startTime = componentTimers.get(`query:${queryName}`);
  const now = performance.now();
  const duration = startTime ? now - startTime : 0;
  console.log(
    `[QUERY ${status.toUpperCase()}] ${queryName} @ ${now.toFixed(0)}ms (took ${duration.toFixed(0)}ms)`
  );
}

/**
 * Hook to track component lifecycle in useEffect
 * Usage: useRenderDebug('MyComponent');
 */
export function useRenderDebug(componentName: string) {
  if (!__DEV__) return;

  // This runs on every render
  logRender(componentName);
}
