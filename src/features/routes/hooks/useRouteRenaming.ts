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
    setIsEditing(true);
    // Focus input after a short delay to ensure it's rendered
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, shownName]);

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

    // Update local state immediately for instant feedback
    const previousName = customName;
    setCustomName(trimmedName);

    // Fire rename synchronously - Rust engine updates immediately
    try {
      if (renameRoute(id, trimmedName) === 'nameTaken') {
        setCustomName(previousName);
        inform({
          title: t('routes.duplicateNameTitle'),
          message: t('routes.duplicateNameMessage'),
        });
        return;
      }
    } catch (error) {
      setCustomName(previousName);
      inform({ title: t('routes.renameFailedTitle'), message: t('routes.renameFailedMessage') });
      if (__DEV__) console.error('Failed to save route name:', error);
      return;
    }
    haptics.success();
  }, [customName, editName, id, renameRoute, t]);

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
