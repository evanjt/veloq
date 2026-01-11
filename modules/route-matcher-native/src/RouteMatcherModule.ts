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
// Special handling for addListener/removeListener to avoid "native state unsupported on Proxy" errors
// These methods need to be bound to the actual native module for EventEmitter to work
export default new Proxy({} as any, {
  get(_target, prop) {
    const module = getNativeModule();
    if (!module) {
      throw new Error(`[RouteMatcher] Native module is not available. Property '${String(prop)}' cannot be accessed.`);
    }
    const value = module[prop];
    // Bind methods that interact with native EventEmitter state
    if (typeof value === "function" && (prop === "addListener" || prop === "removeListener" || prop === "removeAllListeners")) {
      return value.bind(module);
    }
    return value;
  },
  has(_target, prop) {
    const module = getNativeModule();
    return module !== null && prop in module;
  },
});
