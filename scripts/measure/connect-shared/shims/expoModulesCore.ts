// No native module answers in a browser.
export function requireOptionalNativeModule<T>(_name: string): T | null {
  return null;
}
