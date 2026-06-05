import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, TextInput } from 'react-native';
import type { TFunction } from 'i18next';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { getAllRouteDisplayNames } from './useRouteGroups';

export function useRouteRenaming(
  id: string | undefined,
  routeGroupBaseName: string | undefined,
  t: TFunction
) {
  // State for route renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (id) {
      const engine = getRouteEngine();
      const names = engine?.getAllRouteNames() ?? {};
      if (names[id]) {
        setCustomName(names[id]);
      }
    }
  }, [id]);

  // Rename function - calls engine directly (no need to load all groups)
  const renameRoute = useCallback((routeId: string, name: string) => {
    const engine = getRouteEngine();
    if (!engine) {
      throw new Error('Route engine not initialized');
    }
    engine.setRouteName(routeId, name);
    // Engine fires 'groups' event which triggers subscribers to refresh
  }, []);

  // Handle starting to edit the route name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || routeGroupBaseName || '';
    setEditName(currentName);
    setIsEditing(true);
    // Focus input after a short delay to ensure it's rendered
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, routeGroupBaseName]);

  // Handle saving the edited route name
  // Uses renameRoute hook which triggers engine event for consistent UI updates
  const handleSaveName = useCallback(() => {
    // Dismiss keyboard and close edit UI immediately for responsive feel
    Keyboard.dismiss();
    setIsEditing(false);

    const trimmedName = editName.trim();
    if (!trimmedName || !id) {
      return;
    }

    // Check uniqueness against ALL route names (custom + auto-generated)
    const allDisplayNames = getAllRouteDisplayNames();
    const isDuplicate = Object.entries(allDisplayNames).some(
      ([existingId, name]) => existingId !== id && name === trimmedName
    );

    if (isDuplicate) {
      Alert.alert(t('routes.duplicateNameTitle'), t('routes.duplicateNameMessage'));
      return;
    }

    // Update local state immediately for instant feedback
    setCustomName(trimmedName);

    // Fire rename synchronously - Rust engine updates immediately
    try {
      renameRoute(id, trimmedName);
    } catch (error) {
      if (__DEV__) console.error('Failed to save route name:', error);
    }
  }, [editName, id, renameRoute, t]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

  return {
    isEditing,
    setIsEditing,
    editName,
    setEditName,
    customName,
    setCustomName,
    nameInputRef,
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
    renameRoute,
  };
}
