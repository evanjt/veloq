// Turbo Module spec for uniffi-bindgen-react-native
// This spec defines the minimal interface needed to install the Rust bindings via JSI
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  installRustCrate(): boolean;
  cleanupRustCrate(): boolean;
}

// Use getEnforcing - crash if module not found (no fallbacks)
export default TurboModuleRegistry.getEnforcing<Spec>('Veloq');
