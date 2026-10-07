/**
 * The section hero's name, tap to rename. The text being typed lives here and
 * nowhere above it, so a keystroke renders this row and not the screen that
 * mounts the header.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HeroNameRow } from '@/shared/ui';
import type { MaterialIconName } from '@/shared/activity/activityUtils';

/** Delay before the input takes focus, so the row has mounted it. */
const FOCUS_DELAY_MS = 100;

export interface SectionNameEditorProps {
  /** The name shown while not editing. */
  name: string;
  /** The text the input starts from, empty for a section that has no name. */
  startText: string;
  iconName: MaterialIconName;
  activityColor: string;
  /** Called with the typed name, untrimmed, when the athlete saves. */
  onSaveName: (name: string) => void;
}

export function SectionNameEditor({
  name,
  startText,
  iconName,
  activityColor,
  onSaveName,
}: SectionNameEditorProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const timer = isEditing
      ? setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS)
      : undefined;
    return () => clearTimeout(timer);
  }, [isEditing]);

  const handleStart = useCallback(() => {
    setEditName(startText);
    setIsEditing(true);
  }, [startText]);

  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    setIsEditing(false);
    onSaveName(editName);
  }, [editName, onSaveName]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

  return (
    <HeroNameRow
      name={name}
      icon={{ name: iconName, color: activityColor }}
      editable={{
        isEditing,
        editName,
        inputRef,
        placeholder: t('sections.sectionNamePlaceholder'),
        testIDPrefix: 'section',
        onStartEdit: handleStart,
        onSave: handleSave,
        onCancel: handleCancel,
        onChange: setEditName,
      }}
    />
  );
}
