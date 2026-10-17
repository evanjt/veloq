/**
 * The one notice for a capability the athlete has not allowed: a warning
 * inline notice, one line saying what is off, and one action. While the system
 * will still ask, the action raises its dialog; once it has stopped asking, the
 * action opens Veloq's page in system settings, the only place left that can
 * change it.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { openAppSettings } from '@/shared/app/permissions';
import { Button } from './Button';
import { InlineNotice } from './InlineNotice';

/** The action that takes the athlete to Veloq's page in system settings. */
export function OpenSettingsButton({ testID }: { testID: string }) {
  const { t } = useTranslation();
  return (
    <Button
      testID={testID}
      label={t('common.openSettings')}
      onPress={openAppSettings}
      variant="ghost"
      size="sm"
    />
  );
}

interface PermissionNoticeProps {
  outcome: 'askable' | 'blocked';
  /** One line naming what is off. */
  reason: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Raises the system dialog; used while the outcome is askable. */
  onAllow: () => void;
  testID: string;
}

export function PermissionNotice({
  outcome,
  reason,
  icon,
  onAllow,
  testID,
}: PermissionNoticeProps) {
  const { t } = useTranslation();
  return (
    <InlineNotice
      testID={testID}
      tone="warning"
      icon={icon}
      title={reason}
      action={
        outcome === 'blocked' ? (
          <OpenSettingsButton testID={`${testID}-settings`} />
        ) : (
          <Button
            testID={`${testID}-allow`}
            label={t('common.allow')}
            onPress={onAllow}
            variant="ghost"
            size="sm"
          />
        )
      }
    />
  );
}
