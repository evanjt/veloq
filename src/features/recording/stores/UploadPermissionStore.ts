import { create } from 'zustand';

import { getSetting, setSetting, removeSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';

const log = debug.create('UploadPermission');
const STORAGE_KEY = 'veloq-upload-permission';

interface PersistedState {
  hasWritePermission: boolean | null;
  bannerDismissed?: boolean;
  grantedScopes?: string;
}

interface UploadPermissionState {
  needsUpgrade: boolean;
  /** null = unchecked, true = granted, false = denied */
  hasWritePermission: boolean | null;
  /**
   * Whether the persisted answer has been read yet. A cold start into a one-tap
   * record surface can reach the recording screen before it has, and a null
   * `hasWritePermission` then means "not asked yet" rather than "denied": two
   * answers that must not be gated the same way.
   */
  isLoaded: boolean;
  /** User dismissed the permission banner - don't show again until reset */
  bannerDismissed: boolean;
  /** Raw OAuth scope string, e.g. "ACTIVITY:WRITE,WELLNESS:READ" */
  grantedScopes: string | null;
  initialize: () => Promise<void>;
  /** Parse OAuth scope string and persist write permission state */
  setFromOAuthScope: (scope: string) => void;
  setNeedsUpgrade: (v: boolean) => void;
  setHasWritePermission: (v: boolean) => void;
  dismissBanner: () => void;
  reset: () => void;
}

/**
 * Check if an OAuth scope string includes ACTIVITY:WRITE.
 * Scopes are comma-separated: "ACTIVITY:READ,ACTIVITY:WRITE,WELLNESS:READ"
 */
function scopeIncludesWrite(scope: string): boolean {
  return scope
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .includes('ACTIVITY:WRITE');
}

export const useUploadPermissionStore = create<UploadPermissionState>((set, get) => ({
  needsUpgrade: false,
  hasWritePermission: null,
  isLoaded: false,
  bannerDismissed: false,
  grantedScopes: null,

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const parsed: PersistedState = JSON.parse(stored);
        if (typeof parsed.hasWritePermission === 'boolean') {
          set({
            hasWritePermission: parsed.hasWritePermission,
            needsUpgrade: !parsed.hasWritePermission,
            bannerDismissed: parsed.bannerDismissed ?? false,
            grantedScopes: parsed.grantedScopes ?? null,
          });
        }
      }
    } catch {
      // Ignore parse errors
    } finally {
      // On every path, including the throw: a screen that waits for this would
      // otherwise wait forever on a storage read that failed.
      set({ isLoaded: true });
    }
  },

  setFromOAuthScope: (scope: string) => {
    const hasWrite = scopeIncludesWrite(scope);
    log.log(`OAuth scope check: ${hasWrite ? 'has' : 'missing'} ACTIVITY:WRITE (scope: ${scope})`);
    const { bannerDismissed } = get();
    set({
      hasWritePermission: hasWrite,
      needsUpgrade: !hasWrite,
      grantedScopes: scope,
      isLoaded: true,
    });
    setSetting(
      STORAGE_KEY,
      JSON.stringify({ hasWritePermission: hasWrite, bannerDismissed, grantedScopes: scope })
    ).catch(() => {});
  },

  setNeedsUpgrade: (v) => set({ needsUpgrade: v }),

  setHasWritePermission: (v) => {
    const { bannerDismissed } = get();
    set({ hasWritePermission: v, needsUpgrade: !v, isLoaded: true });
    setSetting(STORAGE_KEY, JSON.stringify({ hasWritePermission: v, bannerDismissed })).catch(
      () => {}
    );
  },

  dismissBanner: () => {
    const { hasWritePermission } = get();
    set({ bannerDismissed: true });
    setSetting(STORAGE_KEY, JSON.stringify({ hasWritePermission, bannerDismissed: true })).catch(
      () => {}
    );
  },

  reset: () => {
    // Unloaded again, not loaded-with-no-answer: a sign-out leaves the next
    // account's scope unknown until it says so.
    set({ needsUpgrade: false, hasWritePermission: null, isLoaded: false, bannerDismissed: false });
    removeSetting(STORAGE_KEY).catch(() => {});
  },
}));

export async function initializeUploadPermission(): Promise<void> {
  await useUploadPermissionStore.getState().initialize();
}
