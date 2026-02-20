import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseWithSchema } from '@/lib/utils/validation';
import type { MapStyleType } from '@/components/maps/mapStyles';
import type { ActivityType } from '@/types';
import { isActivityType } from '@/types';

const STORAGE_KEY = 'veloq-map-preferences';

export interface MapPreferences {
  defaultStyle: MapStyleType;
  activityTypeStyles: Partial<Record<ActivityType, MapStyleType>>;
  terrain3DDefault: boolean;
  terrain3DByType: Partial<Record<ActivityType, boolean>>;
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
  getStyleForActivity: (activityType: ActivityType) => MapStyleType;
  setTerrain3D: (activityType: ActivityType | null, enabled: boolean) => Promise<void>;
  isTerrain3DEnabled: (activityType: ActivityType) => boolean;
  isAnyTerrain3DEnabled: boolean;
}

const DEFAULT_PREFERENCES: MapPreferences = {
  defaultStyle: 'light',
  activityTypeStyles: {},
  terrain3DDefault: false,
  terrain3DByType: {},
};

/** Valid map style values */
const VALID_MAP_STYLES = new Set<MapStyleType>(['light', 'dark', 'satellite']);

/**
 * Validate that a value is a valid MapPreferences object.
 */
function isValidMapPreferences(value: unknown): value is MapPreferences {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  // Validate defaultStyle
  if (
    typeof obj.defaultStyle !== 'string' ||
    !VALID_MAP_STYLES.has(obj.defaultStyle as MapStyleType)
  ) {
    return false;
  }

  // Validate activityTypeStyles if present
  if (obj.activityTypeStyles !== undefined) {
    if (typeof obj.activityTypeStyles !== 'object' || obj.activityTypeStyles === null) {
      return false;
    }
    for (const [key, val] of Object.entries(obj.activityTypeStyles)) {
      if (!isActivityType(key) || !VALID_MAP_STYLES.has(val as MapStyleType)) {
        return false;
      }
    }
  }

  // Validate terrain3DDefault if present (optional, defaults to false)
  if (obj.terrain3DDefault !== undefined && typeof obj.terrain3DDefault !== 'boolean') {
    return false;
  }

  // Validate terrain3DByType if present (optional)
  if (obj.terrain3DByType !== undefined) {
    if (typeof obj.terrain3DByType !== 'object' || obj.terrain3DByType === null) {
      return false;
    }
    for (const [key, val] of Object.entries(obj.terrain3DByType)) {
      if (!isActivityType(key) || typeof val !== 'boolean') {
        return false;
      }
    }
  }

  return true;
}

const MapPreferencesContext = createContext<MapPreferencesContextValue | null>(null);

export function MapPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<MapPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preferences on mount with schema validation
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        const parsed = safeJsonParseWithSchema(saved, isValidMapPreferences, DEFAULT_PREFERENCES);
        setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, []);

  // Save preferences to storage
  const savePreferences = useCallback(async (newPrefs: MapPreferences) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
  }, []);

  // Set default style - persist inside callback to fix React 18 batching issue
  const setDefaultStyle = useCallback(
    async (style: MapStyleType) => {
      setPreferences((prev) => {
        const newPrefs = { ...prev, defaultStyle: style };
        // Persist inside callback where newPrefs is captured correctly
        // (React 18 batching defers setState, so external access to newPrefs would be null)
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
        // Persist inside callback where newPrefs is captured correctly
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
        // Persist inside callback where newPrefs is captured correctly
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

  // Get style for a specific activity type
  const getStyleForActivity = useCallback(
    (activityType: ActivityType): MapStyleType => {
      return preferences.activityTypeStyles[activityType] ?? preferences.defaultStyle;
    },
    [preferences]
  );

  // Set 3D terrain preference - null activityType sets the default
  const setTerrain3D = useCallback(
    async (activityType: ActivityType | null, enabled: boolean) => {
      setPreferences((prev) => {
        let newPrefs: MapPreferences;
        if (activityType === null) {
          newPrefs = { ...prev, terrain3DDefault: enabled };
        } else {
          const newByType = { ...prev.terrain3DByType };
          if (enabled === prev.terrain3DDefault) {
            // Remove override if it matches default
            delete newByType[activityType];
          } else {
            newByType[activityType] = enabled;
          }
          newPrefs = { ...prev, terrain3DByType: newByType };
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

  // Check if 3D terrain is enabled for a specific activity type
  const isTerrain3DEnabled = useCallback(
    (activityType: ActivityType): boolean => {
      return preferences.terrain3DByType[activityType] ?? preferences.terrain3DDefault;
    },
    [preferences]
  );

  // Check if any activity type has 3D terrain enabled
  const isAnyTerrain3DEnabled = useMemo(() => {
    if (preferences.terrain3DDefault) return true;
    return Object.values(preferences.terrain3DByType).some((v) => v === true);
  }, [preferences.terrain3DDefault, preferences.terrain3DByType]);

  return (
    <MapPreferencesContext.Provider
      value={{
        preferences,
        isLoaded,
        setDefaultStyle,
        setActivityTypeStyle,
        setActivityGroupStyle,
        getStyleForActivity,
        setTerrain3D,
        isTerrain3DEnabled,
        isAnyTerrain3DEnabled,
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
