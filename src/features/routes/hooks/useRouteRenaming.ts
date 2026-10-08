import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, TextInput } from 'react-native';
import type { TFunction } from 'i18next';
import { setRouteName } from '../lib/nameCommands';
import * as haptics from '@/shared/ui/haptics';

/**
 * `routeNames` is the name map the route detail read carries, the one reader
 * of route names on that screen. Undefined while the read is loading.
 */
export function useRouteRenaming(
  id: string | undefined,
  routeGroupBaseName: string | undefined,
  t: TFunction,
  routeNames: Record<string, string> | undefined
) {
  // State for route renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);
  const openedWithName = useRef<string | null>(null);

  const readNames = useCallback(() => routeNames ?? {}, [routeNames]);

  useEffect(() => {
    if (id) {
      const names = readNames();
      if (names[id]) {
        setCustomName(names[id]);
      }
    }
  }, [id, readNames]);

  // Engine fires 'groups' event which triggers subscribers to refresh
  const renameRoute = useCallback((routeId: string, name: string) => {
    setRouteName(routeId, name);
  }, []);

  // Handle starting to edit the route name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || routeGroupBaseName || '';
    openedWithName.current = currentName.trim();
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

    // An unchanged field is not a rename. Writing it would turn a shown number
    // into a typed name fixed in the current language.
    if (trimmedName === openedWithName.current) {
      return;
    }

    // Uniqueness runs over the engine's name map, the same source the current
    // name was seeded from. It holds every group's shown name, typed names and
    // numbered labels alike.
    const isDuplicate = Object.entries(readNames()).some(
      ([existingId, name]) => existingId !== id && name === trimmedName
    );

    if (isDuplicate) {
      Alert.alert(t('routes.duplicateNameTitle'), t('routes.duplicateNameMessage'));
      return;
    }

    // Update local state immediately for instant feedback
    const previousName = customName;
    setCustomName(trimmedName);

    // Fire rename synchronously - Rust engine updates immediately
    try {
      renameRoute(id, trimmedName);
    } catch (error) {
      setCustomName(previousName);
      Alert.alert(t('routes.renameFailedTitle'), t('routes.renameFailedMessage'));
      if (__DEV__) console.error('Failed to save route name:', error);
      return;
    }
    haptics.success();
  }, [customName, editName, id, readNames, renameRoute, t]);

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
