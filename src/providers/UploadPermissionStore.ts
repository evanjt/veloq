import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/lib/utils/debug';

const log = debug.create('UploadPermission');
const STORAGE_KEY = 'veloq-upload-permission';

interface PersistedState {
  hasWritePermission: boolean | null;
  bannerDismissed?: boolean;
}

interface UploadPermissionState {
  needsUpgrade: boolean;
  /** null = unchecked, true = granted, false = denied */
  hasWritePermission: boolean | null;
  /** User dismissed the permission banner — don't show again until reset */
  bannerDismissed: boolean;
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
  bannerDismissed: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: PersistedState = JSON.parse(stored);
        if (typeof parsed.hasWritePermission === 'boolean') {
          set({
            hasWritePermission: parsed.hasWritePermission,
            needsUpgrade: !parsed.hasWritePermission,
            bannerDismissed: parsed.bannerDismissed ?? false,
          });
        }
      }
    } catch {
      // Ignore parse errors
    }
  },

  setFromOAuthScope: (scope: string) => {
    const hasWrite = scopeIncludesWrite(scope);
    log.log(`OAuth scope check: ${hasWrite ? 'has' : 'missing'} ACTIVITY:WRITE (scope: ${scope})`);
    set({ hasWritePermission: hasWrite, needsUpgrade: !hasWrite });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ hasWritePermission: hasWrite })).catch(
      () => {}
    );
  },

  setNeedsUpgrade: (v) => set({ needsUpgrade: v }),

  setHasWritePermission: (v) => {
    const { bannerDismissed } = get();
    set({ hasWritePermission: v, needsUpgrade: !v });
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hasWritePermission: v, bannerDismissed })
    ).catch(() => {});
  },

  dismissBanner: () => {
    const { hasWritePermission } = get();
    set({ bannerDismissed: true });
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hasWritePermission, bannerDismissed: true })
    ).catch(() => {});
  },

  reset: () => {
    set({ needsUpgrade: false, hasWritePermission: null, bannerDismissed: false });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));

export async function initializeUploadPermission(): Promise<void> {
  await useUploadPermissionStore.getState().initialize();
}
