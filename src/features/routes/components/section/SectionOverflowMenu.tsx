import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iconSize } from '@/theme';
import { chromeMenuIcon, IconButton } from '@/shared/ui';
import { MenuPopup, type MenuPopupAction } from '@/shared/ui/ContextMenu';
import { Icon } from '@/shared/ui/Icon';
import { sectionSwipeKind } from '../SectionSwipeAction';

export interface SectionOverflowMenuProps {
  sectionType: string;
  isSectionDisabled: boolean;
  isRematching: boolean;
  /** Detection is held, so a rematch would be refused. */
  isRematchHeld: boolean;
  onDelete: () => void;
  onToggleDisable: () => void;
  onRematch?: (() => void) | undefined;
  /** The header's tint, so the trigger reads on the map and on the opaque header alike. */
  tint: string;
}

/**
 * The section page's rarer actions, in the native header's overflow menu:
 * rematch, then delete (custom) or remove and restore (detected). The
 * destructive row sits last, and delete asks for confirmation in its handler.
 */
export function SectionOverflowMenu({
  sectionType,
  isSectionDisabled,
  isRematching,
  isRematchHeld,
  onDelete,
  onToggleDisable,
  onRematch,
  tint,
}: SectionOverflowMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const kind = sectionSwipeKind(sectionType, isSectionDisabled);

  const entries: MenuPopupAction[] = [];
  if (onRematch && !isRematching && !isRematchHeld) {
    entries.push({
      key: 'rematch',
      label: t('sections.rematchActivities'),
      icon: 'refresh',
      onPress: onRematch,
    });
  }
  if (kind === 'delete') {
    entries.push({
      key: 'delete',
      label: t('sections.deleteSection'),
      ...chromeMenuIcon('delete'),
      onPress: onDelete,
      destructive: true,
    });
  } else {
    entries.push({
      key: kind,
      label: kind === 'restore' ? t('sections.restoreSection') : t('sections.removeSection'),
      icon: kind === 'restore' ? 'undo' : 'minus-circle-outline',
      onPress: onToggleDisable,
      destructive: kind === 'remove',
    });
  }

  return (
    <MenuPopup
      title={t('activity.moreActions')}
      entries={entries}
      visible={open}
      onDismiss={() => setOpen(false)}
    >
      <IconButton
        testID="section-overflow-menu"
        accessibilityLabel={t('activity.moreActions')}
        onPress={() => setOpen(true)}
      >
        <Icon name="dots-vertical" size={iconSize.md} color={tint} />
      </IconButton>
    </MenuPopup>
  );
}
