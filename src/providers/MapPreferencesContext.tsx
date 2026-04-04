import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { getSetting, setSetting } from '@/lib/backup';
import { safeJsonParseWithSchema } from '@/lib/utils/validation';
import type { MapStyleType } from '@/components/maps/mapStyles';
import type { ActivityType, Terrain3DMode } from '@/types';
import { isActivityType } from '@/types';
import { useAuthStore } from './AuthStore';

const STORAGE_KEY = 'veloq-map-preferences';
const ACTIVITY_OVERRIDES_KEY = 'veloq-map-activity-overrides';

const VALID_TERRAIN_MODES = new Set<Terrain3DMode>(['off', 'smart', 'always']);

export interface ActivityMapOverride {
  style?: MapStyleType;
  terrain3D?: boolean;
}

export interface MapPreferences {
  defaultStyle: MapStyleType;
  activityTypeStyles: Partial<Record<ActivityType, MapStyleType>>;
  terrain3DMode: Terrain3DMode;
  terrain3DModeByType: Partial<Record<ActivityType, Terrain3DMode>>;
}

interface MapPreferencesContextValue {
  preferences: MapPreferences;
  isLoaded: boolean;
  setDefaultStyle: (style: MapStyleType) => Promise<void>;
  setActivityTypeStyle: (activityType: ActivityType, style: MapStyleType | null) => Promise<void>;
  setActivityGroupStyle: (
    activityTypes: ActivityType[],
    style: MapStyleType | null
  ) => Promise<void>;
  getStyleForActivity: (
    activityType: ActivityType,
    activityId?: string,
    country?: string | null
  ) => MapStyleType;
  setTerrain3DMode: (activityType: ActivityType | null, mode: Terrain3DMode) => Promise<void>;
  setTerrain3DModeGroup: (activityTypes: ActivityType[], mode: Terrain3DMode) => Promise<void>;
  getTerrain3DMode: (activityType: ActivityType, activityId?: string) => Terrain3DMode;
  isAnyTerrain3DEnabled: boolean;
  setActivityOverride: (activityId: string, override: ActivityMapOverride) => Promise<void>;
  clearActivityOverride: (activityId: string) => Promise<void>;
  hasActivityOverride: (activityId: string) => boolean;
  getActivityOverride: (activityId: string) => ActivityMapOverride | undefined;
}

const DEFAULT_PREFERENCES: MapPreferences = {
  defaultStyle: 'light',
  activityTypeStyles: {},
  terrain3DMode: 'smart',
  terrain3DModeByType: {},
};

/** Valid map style values */
const VALID_MAP_STYLES = new Set<MapStyleType>(['light', 'dark', 'satellite']);

/** Migrate legacy boolean terrain preferences to Terrain3DMode */
function migrateBooleanTerrain(obj: Record<string, unknown>): {
  terrain3DMode: Terrain3DMode;
  terrain3DModeByType: Partial<Record<ActivityType, Terrain3DMode>>;
} {
  // Migrate terrain3DDefault: true → 'always', false → 'off'
  let terrain3DMode: Terrain3DMode = DEFAULT_PREFERENCES.terrain3DMode;
  if (typeof obj.terrain3DDefault === 'boolean') {
    terrain3DMode = obj.terrain3DDefault ? 'always' : 'off';
  } else if (
    typeof obj.terrain3DMode === 'string' &&
    VALID_TERRAIN_MODES.has(obj.terrain3DMode as Terrain3DMode)
  ) {
    terrain3DMode = obj.terrain3DMode as Terrain3DMode;
  }

  // Migrate terrain3DByType: boolean → Terrain3DMode
  const terrain3DModeByType: Partial<Record<ActivityType, Terrain3DMode>> = {};
  if (typeof obj.terrain3DByType === 'object' && obj.terrain3DByType !== null) {
    for (const [key, val] of Object.entries(obj.terrain3DByType as Record<string, unknown>)) {
      if (!isActivityType(key)) continue;
      if (typeof val === 'boolean') {
        terrain3DModeByType[key] = val ? 'always' : 'off';
      }
    }
  } else if (typeof obj.terrain3DModeByType === 'object' && obj.terrain3DModeByType !== null) {
    for (const [key, val] of Object.entries(obj.terrain3DModeByType as Record<string, unknown>)) {
      if (!isActivityType(key) || !VALID_TERRAIN_MODES.has(val as Terrain3DMode)) continue;
      terrain3DModeByType[key] = val as Terrain3DMode;
    }
  }

  return { terrain3DMode, terrain3DModeByType };
}

/**
 * Validate and normalize stored preferences, handling migration from legacy booleans.
 */
function parseStoredPreferences(value: unknown): MapPreferences | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;

  // Validate defaultStyle
  if (
    typeof obj.defaultStyle !== 'string' ||
    !VALID_MAP_STYLES.has(obj.defaultStyle as MapStyleType)
  ) {
    return null;
  }

  // Validate activityTypeStyles if present
  const activityTypeStyles: Partial<Record<ActivityType, MapStyleType>> = {};
  if (typeof obj.activityTypeStyles === 'object' && obj.activityTypeStyles !== null) {
    for (const [key, val] of Object.entries(obj.activityTypeStyles as Record<string, unknown>)) {
      if (!isActivityType(key) || !VALID_MAP_STYLES.has(val as MapStyleType)) continue;
      activityTypeStyles[key] = val as MapStyleType;
    }
  }

  // Migrate or parse terrain3D settings
  const { terrain3DMode, terrain3DModeByType } = migrateBooleanTerrain(obj);

  return {
    defaultStyle: obj.defaultStyle as MapStyleType,
    activityTypeStyles,
    terrain3DMode,
    terrain3DModeByType,
  };
}

const MapPreferencesContext = createContext<MapPreferencesContextValue | null>(null);

export function MapPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<MapPreferences>(DEFAULT_PREFERENCES);
  const [activityOverrides, setActivityOverrides] = useState<Record<string, ActivityMapOverride>>(
    {}
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preferences on mount with migration support
  useEffect(() => {
    Promise.all([getSetting(STORAGE_KEY), getSetting(ACTIVITY_OVERRIDES_KEY)])
      .then(([saved, savedOverrides]) => {
        if (saved) {
          try {
            const raw = JSON.parse(saved);
            const parsed = parseStoredPreferences(raw);
            setPreferences(parsed ?? DEFAULT_PREFERENCES);
          } catch {
            // Invalid JSON
          }
        }
        if (savedOverrides) {
          try {
            const parsed = JSON.parse(savedOverrides);
            if (typeof parsed === 'object' && parsed !== null) {
              // Validate entries
              const valid: Record<string, ActivityMapOverride> = {};
              for (const [key, val] of Object.entries(parsed)) {
                if (typeof val !== 'object' || val === null) continue;
                const entry = val as Record<string, unknown>;
                const override: ActivityMapOverride = {};
                if (
                  typeof entry.style === 'string' &&
                  VALID_MAP_STYLES.has(entry.style as MapStyleType)
                ) {
                  override.style = entry.style as MapStyleType;
                }
                if (typeof entry.terrain3D === 'boolean') {
                  override.terrain3D = entry.terrain3D;
                }
                if (override.style !== undefined || override.terrain3D !== undefined) {
                  valid[key] = override;
                }
              }
              setActivityOverrides(valid);
            }
          } catch {
            // Invalid JSON
          }
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, []);

  // Save preferences to storage
  const savePreferences = useCallback(async (newPrefs: MapPreferences) => {
    await setSetting(STORAGE_KEY, JSON.stringify(newPrefs));
  }, []);

  // Set default style - persist inside callback to fix React 18 batching issue
  const setDefaultStyle = useCallback(
    async (style: MapStyleType) => {
      setPreferences((prev) => {
        const newPrefs = { ...prev, defaultStyle: style };
        savePreferences(newPrefs).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist:', error);
          }
        });
        return newPrefs;
      });
    },
    [savePreferences]
  );

  // Set activity type style - persist inside callback to fix React 18 batching issue
  const setActivityTypeStyle = useCallback(
    async (activityType: ActivityType, style: MapStyleType | null) => {
      setPreferences((prev) => {
        const newStyles = { ...prev.activityTypeStyles };
        if (style === null) {
          delete newStyles[activityType];
        } else {
          newStyles[activityType] = style;
        }
        const newPrefs = { ...prev, activityTypeStyles: newStyles };
        savePreferences(newPrefs).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist:', error);
          }
        });
        return newPrefs;
      });
    },
    [savePreferences]
  );

  // Set style for a group of activity types (batch update) - persist inside callback
  const setActivityGroupStyle = useCallback(
    async (activityTypes: ActivityType[], style: MapStyleType | null) => {
      setPreferences((prev) => {
        const newStyles = { ...prev.activityTypeStyles };
        for (const activityType of activityTypes) {
          if (style === null) {
            delete newStyles[activityType];
          } else {
            newStyles[activityType] = style;
          }
        }
        const newPrefs = { ...prev, activityTypeStyles: newStyles };
        savePreferences(newPrefs).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist:', error);
          }
        });
        return newPrefs;
      });
    },
    [savePreferences]
  );

  // Get style for a specific activity type, with optional per-activity override
  // In demo mode, Swiss activities default to satellite for scenic mountain imagery
  const getStyleForActivity = useCallback(
    (activityType: ActivityType, activityId?: string, country?: string | null): MapStyleType => {
      if (activityId) {
        const override = activityOverrides[activityId];
        if (override?.style) return override.style;
      }
      if (country === 'Switzerland' && useAuthStore.getState().isDemoMode) {
        return 'satellite';
      }
      return preferences.activityTypeStyles[activityType] ?? preferences.defaultStyle;
    },
    [preferences, activityOverrides]
  );

  // Set 3D terrain mode - null activityType sets the default
  const setTerrain3DMode = useCallback(
    async (activityType: ActivityType | null, mode: Terrain3DMode) => {
      setPreferences((prev) => {
        let newPrefs: MapPreferences;
        if (activityType === null) {
          newPrefs = { ...prev, terrain3DMode: mode };
        } else {
          const newByType = { ...prev.terrain3DModeByType };
          if (mode === prev.terrain3DMode) {
            // Remove override if it matches default
            delete newByType[activityType];
          } else {
            newByType[activityType] = mode;
          }
          newPrefs = { ...prev, terrain3DModeByType: newByType };
        }
        savePreferences(newPrefs).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist:', error);
          }
        });
        return newPrefs;
      });
    },
    [savePreferences]
  );

  // Set 3D terrain mode for a group of activity types (batch update)
  const setTerrain3DModeGroup = useCallback(
    async (activityTypes: ActivityType[], mode: Terrain3DMode) => {
      setPreferences((prev) => {
        const newByType = { ...prev.terrain3DModeByType };
        for (const activityType of activityTypes) {
          if (mode === prev.terrain3DMode) {
            delete newByType[activityType];
          } else {
            newByType[activityType] = mode;
          }
        }
        const newPrefs: MapPreferences = { ...prev, terrain3DModeByType: newByType };
        savePreferences(newPrefs).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist:', error);
          }
        });
        return newPrefs;
      });
    },
    [savePreferences]
  );

  // Get 3D terrain mode for a specific activity type, with optional per-activity override
  const getTerrain3DMode = useCallback(
    (activityType: ActivityType, activityId?: string): Terrain3DMode => {
      if (activityId) {
        const override = activityOverrides[activityId];
        if (override?.terrain3D !== undefined) {
          return override.terrain3D ? 'always' : 'off';
        }
      }
      return preferences.terrain3DModeByType[activityType] ?? preferences.terrain3DMode;
    },
    [preferences, activityOverrides]
  );

  // Save activity overrides to storage
  const saveActivityOverrides = useCallback(
    async (overrides: Record<string, ActivityMapOverride>) => {
      await setSetting(ACTIVITY_OVERRIDES_KEY, JSON.stringify(overrides));
    },
    []
  );

  // Set per-activity map override
  const setActivityOverride = useCallback(
    async (activityId: string, override: ActivityMapOverride) => {
      setActivityOverrides((prev) => {
        const existing = prev[activityId] ?? {};
        const merged = { ...existing, ...override };
        const next = { ...prev, [activityId]: merged };
        saveActivityOverrides(next).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist activity override:', error);
          }
        });
        return next;
      });
    },
    [saveActivityOverrides]
  );

  // Clear per-activity map override
  const clearActivityOverride = useCallback(
    async (activityId: string) => {
      setActivityOverrides((prev) => {
        const next = { ...prev };
        delete next[activityId];
        saveActivityOverrides(next).catch((error) => {
          if (__DEV__) {
            console.warn('[MapPreferences] Failed to persist activity override removal:', error);
          }
        });
        return next;
      });
    },
    [saveActivityOverrides]
  );

  // Check if an activity has a per-activity override
  const hasActivityOverride = useCallback(
    (activityId: string): boolean => {
      return activityId in activityOverrides;
    },
    [activityOverrides]
  );

  // Get the override for an activity (if any)
  const getActivityOverride = useCallback(
    (activityId: string): ActivityMapOverride | undefined => {
      return activityOverrides[activityId];
    },
    [activityOverrides]
  );

  // Check if any activity type has 3D terrain enabled (not 'off')
  const isAnyTerrain3DEnabled = useMemo(() => {
    if (preferences.terrain3DMode !== 'off') return true;
    return Object.values(preferences.terrain3DModeByType).some((v) => v !== 'off');
  }, [preferences.terrain3DMode, preferences.terrain3DModeByType]);

  return (
    <MapPreferencesContext.Provider
      value={{
        preferences,
        isLoaded,
        setDefaultStyle,
        setActivityTypeStyle,
        setActivityGroupStyle,
        getStyleForActivity,
        setTerrain3DMode,
        setTerrain3DModeGroup,
        getTerrain3DMode,
        isAnyTerrain3DEnabled,
        setActivityOverride,
        clearActivityOverride,
        hasActivityOverride,
        getActivityOverride,
      }}
    >
      {children}
    </MapPreferencesContext.Provider>
  );
}

export function useMapPreferences(): MapPreferencesContextValue {
  const context = useContext(MapPreferencesContext);
  if (!context) {
    throw new Error('useMapPreferences must be used within a MapPreferencesProvider');
  }
  return context;
}
