import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MapStyleType } from '@/components/maps/mapStyles';
import type { ActivityType } from '@/types';

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

const MapPreferencesContext = createContext<MapPreferencesContextValue | null>(null);

export function MapPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<MapPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved) {
          const parsed = JSON.parse(saved);
          setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
        }
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
    setPreferences(prev => {
      const newStyles = { ...prev.activityTypeStyles };
      if (style === null) {
        delete newStyles[activityType];
      } else {
        newStyles[activityType] = style;
      }
      const newPrefs = { ...prev, activityTypeStyles: newStyles };
      savePreferences(newPrefs);
      return newPrefs;
    });
  }, [savePreferences]);

  // Set style for a group of activity types (batch update)
  const setActivityGroupStyle = useCallback(async (activityTypes: ActivityType[], style: MapStyleType | null) => {
    setPreferences(prev => {
      const newStyles = { ...prev.activityTypeStyles };
      for (const activityType of activityTypes) {
        if (style === null) {
          delete newStyles[activityType];
        } else {
          newStyles[activityType] = style;
        }
      }
      const newPrefs = { ...prev, activityTypeStyles: newStyles };
      savePreferences(newPrefs);
      return newPrefs;
    });
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
