/**
 * The section's name, tap to rename. The text being typed lives here and
 * nowhere above it, so a keystroke renders this row and not the screen that
 * mounts the header.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HeroNameRow, type TextFieldHandle } from '@/shared/ui';
import type { MaterialIconName } from '@/shared/activity/activityUtils';
import type { NameSaveOutcome } from '@/features/routes/lib/sectionRenameFailure';

/** Delay before the input takes focus, so the row has mounted it. */
const FOCUS_DELAY_MS = 100;

export interface SectionNameEditorProps {
  /** The name shown while not editing. */
  name: string;
  /** The text the input starts from, empty for a section that has no name. */
  startText: string;
  iconName: MaterialIconName;
  activityColor: string;
  /**
   * Called with the typed name, untrimmed, when the athlete saves. The field
   * closes once the name is saved and stays open with the reason when not.
   */
  onSaveName: (name: string) => Promise<NameSaveOutcome>;
  /** A control drawn beside the name while it is not being edited. */
  accessory?: React.ReactNode;
  /** Drawn on a sheet's surface in the theme's text, rather than over the map in white. */
  onSurface?: boolean;
}

export function SectionNameEditor({
  name,
  startText,
  iconName,
  activityColor,
  onSaveName,
  accessory,
  onSurface = false,
}: SectionNameEditorProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const inputRef = useRef<TextFieldHandle>(null);

  useEffect(() => {
    const timer = isEditing
      ? setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS)
      : undefined;
    return () => clearTimeout(timer);
  }, [isEditing]);

  const handleStart = useCallback(() => {
    setEditName(startText);
    setNameError(null);
    setIsEditing(true);
  }, [startText]);

  const handleSave = useCallback(async () => {
    const outcome = await onSaveName(editName);
    if (!outcome.saved) {
      setNameError(outcome.reason);
      return;
    }
    Keyboard.dismiss();
    setIsEditing(false);
  }, [editName, onSaveName]);

  const handleChange = useCallback((text: string) => {
    setEditName(text);
    setNameError(null);
  }, []);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    setNameError(null);
    Keyboard.dismiss();
  }, []);

  return (
    <HeroNameRow
      onSurface={onSurface}
      name={name}
      icon={{ name: iconName, color: activityColor }}
      editable={{
        isEditing,
        editName,
        error: nameError,
        inputRef,
        label: t('sections.sectionNamePlaceholder'),
        testIDPrefix: 'section',
        onStartEdit: handleStart,
        onSave: handleSave,
        onCancel: handleCancel,
        onChange: handleChange,
      }}
      accessory={accessory}
    />
  );
}
