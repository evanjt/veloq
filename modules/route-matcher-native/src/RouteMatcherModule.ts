import { requireNativeModule } from "expo-modules-core";

// Lazy load the native module to avoid errors during bundling
// The native module may not be available during initial bundle generation
let nativeModule: any = null;

function getNativeModule() {
  if (nativeModule !== null) {
    return nativeModule;
  }

  try {
    nativeModule = requireNativeModule("RouteMatcher");
  } catch (error) {
    console.warn("[RouteMatcher] Native module not available:", error);
    nativeModule = null;
  }

  return nativeModule;
}

// Export a proxy that lazily loads the native module
export default new Proxy({} as any, {
  get(_target, prop) {
    const module = getNativeModule();
    if (!module) {
      throw new Error(`[RouteMatcher] Native module is not available. Property '${String(prop)}' cannot be accessed.`);
    }
    return module[prop];
  },
  has(_target, prop) {
    const module = getNativeModule();
    return module !== null && prop in module;
  },
});
