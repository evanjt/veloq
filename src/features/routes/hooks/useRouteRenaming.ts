import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import type { TFunction } from 'i18next';
import { setRouteName } from '../lib/nameCommands';
import * as haptics from '@/shared/ui/haptics';
import type { TextFieldHandle } from '@/shared/ui/TextField';
import { inform } from '@/shared/ui/dialog';

/**
 * `shownName` is the name the route detail read gives this route, undefined
 * while the read is loading. Whether a new name is taken by another route is
 * the engine's to judge, on the rename itself.
 */
export function useRouteRenaming(
  id: string | undefined,
  shownName: string | undefined,
  t: TFunction
) {
  // State for route renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<TextFieldHandle>(null);
  const openedWithName = useRef<string | null>(null);

  useEffect(() => {
    if (id && shownName) {
      setCustomName(shownName);
    }
  }, [id, shownName]);

  // Engine fires 'groups' event which triggers subscribers to refresh
  const renameRoute = useCallback(
    (routeId: string, name: string) => setRouteName(routeId, name),
    []
  );

  // Handle starting to edit the route name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || shownName || '';
    openedWithName.current = currentName.trim();
    setEditName(currentName);
    setNameError(null);
    setIsEditing(true);
    // Focus input after a short delay to ensure it's rendered
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, shownName]);

  const closeField = useCallback(() => {
    Keyboard.dismiss();
    setIsEditing(false);
    setNameError(null);
  }, []);

  const handleChangeName = useCallback((text: string) => {
    setEditName(text);
    setNameError(null);
  }, []);

  // The field closes only once the engine has taken the name. A refused name
  // stays in the field with the reason under it, so nothing typed is lost. An
  // empty field clears the typed name and the route's automatic name returns.
  const handleSaveName = useCallback(() => {
    if (!id) {
      return;
    }
    const trimmedName = editName.trim();

    // An unchanged field is not a rename. Writing it would turn a shown number
    // into a typed name fixed in the current language.
    if (trimmedName === openedWithName.current) {
      closeField();
      return;
    }

    try {
      if (renameRoute(id, trimmedName) === 'nameTaken') {
        setNameError(t('routes.duplicateNameMessage'));
        return;
      }
    } catch (error) {
      inform({ title: t('routes.renameFailedTitle'), message: t('routes.renameFailedMessage') });
      if (__DEV__) console.error('Failed to save route name:', error);
      return;
    }
    closeField();
    // A cleared name shows the route's automatic name, which the detail read
    // brings back with the engine's refresh.
    setCustomName(trimmedName || null);
    haptics.success();
  }, [closeField, editName, id, renameRoute, t]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    setNameError(null);
    Keyboard.dismiss();
  }, []);

  return {
    isEditing,
    setIsEditing,
    editName,
    setEditName,
    handleChangeName,
    nameError,
    customName,
    setCustomName,
    nameInputRef,
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
    renameRoute,
  };
}
