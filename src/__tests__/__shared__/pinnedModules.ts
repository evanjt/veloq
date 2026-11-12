/**
 * Keeps third-party modules out of `jest.resetModules()`. A suite that reloads
 * its own source modules for every case, to start each from fresh module state,
 * otherwise evaluates React, React Native and the rest of node_modules again as
 * well, which is most of a case's time. Only modules the suite holds no state
 * in belong here: whatever is pinned stays the one instance for the whole file.
 */
export function pinModules(names: string[]): void {
  for (const name of names) {
    const instance = jest.requireActual(name);
    jest.doMock(name, () => instance);
  }
}
