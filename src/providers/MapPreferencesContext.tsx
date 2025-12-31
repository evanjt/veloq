import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseWithSchema } from '@/lib/utils/validation';
import type { MapStyleType } from '@/components/maps/mapStyles';
import type { ActivityType } from '@/types';
import { isActivityType } from '@/types';

const STORAGE_KEY = 'veloq-map-preferences';

export interface MapPreferences {
  defaultStyle: MapStyleType;
  activityTypeStyles: Partial<Record<ActivityType, MapStyleType>>;
}

interface MapPreferencesContextValue {
  preferences: MapPreferences;
  isLoaded: boolean;
  setDefaultStyle: (style: MapStyleType) => Promise<void>;
  setActivityTypeStyle: (activityType: ActivityType, style: MapStyleType | null) => Promise<void>;
  setActivityGroupStyle: (activityTypes: ActivityType[], style: MapStyleType | null) => Promise<void>;
  getStyleForActivity: (activityType: ActivityType) => MapStyleType;
}

const DEFAULT_PREFERENCES: MapPreferences = {
  defaultStyle: 'light',
  activityTypeStyles: {},
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
  if (typeof obj.defaultStyle !== 'string' || !VALID_MAP_STYLES.has(obj.defaultStyle as MapStyleType)) {
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

  // Set default style
  const setDefaultStyle = useCallback(async (style: MapStyleType) => {
    const newPrefs = { ...preferences, defaultStyle: style };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  }, [preferences, savePreferences]);

  // Set activity type style
  const setActivityTypeStyle = useCallback(async (activityType: ActivityType, style: MapStyleType | null) => {
    let newPrefs: MapPreferences | null = null;
    setPreferences(prev => {
      const newStyles = { ...prev.activityTypeStyles };
      if (style === null) {
        delete newStyles[activityType];
      } else {
        newStyles[activityType] = style;
      }
      newPrefs = { ...prev, activityTypeStyles: newStyles };
      return newPrefs;
    });
    if (newPrefs) {
      await savePreferences(newPrefs);
    }
  }, [savePreferences]);

  // Set style for a group of activity types (batch update)
  const setActivityGroupStyle = useCallback(async (activityTypes: ActivityType[], style: MapStyleType | null) => {
    let newPrefs: MapPreferences | null = null;
    setPreferences(prev => {
      const newStyles = { ...prev.activityTypeStyles };
      for (const activityType of activityTypes) {
        if (style === null) {
          delete newStyles[activityType];
        } else {
          newStyles[activityType] = style;
        }
      }
      newPrefs = { ...prev, activityTypeStyles: newStyles };
      return newPrefs;
    });
    if (newPrefs) {
      await savePreferences(newPrefs);
    }
  }, [savePreferences]);

  // Get style for a specific activity type
  const getStyleForActivity = useCallback((activityType: ActivityType): MapStyleType => {
    return preferences.activityTypeStyles[activityType] ?? preferences.defaultStyle;
  }, [preferences]);

  return (
    <MapPreferencesContext.Provider
      value={{
        preferences,
        isLoaded,
        setDefaultStyle,
        setActivityTypeStyle,
        setActivityGroupStyle,
        getStyleForActivity,
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
