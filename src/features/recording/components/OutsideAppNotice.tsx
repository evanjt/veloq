import React, { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useNotificationPermission } from '@/shared/app/permissions/notifications';
import { Button } from '@/shared/ui/Button';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { OpenSettingsButton } from '@/shared/ui/PermissionNotice';
import { isLiveActivityAvailable, isLiveActivitySupported } from '../lib/liveActivity/bridge';
import { useRecordingPreferences } from '../stores/RecordingPreferencesStore';

/**
 * Whether the lock-screen card is switched off for this app. A tablet has no
 * card and a build without the extension has none to switch on, so neither
 * reads as off.
 */
function liveActivityOff(): boolean {
  if (Platform.OS !== 'ios' || Platform.isPad) return false;
  return isLiveActivityAvailable() && !isLiveActivitySupported();
}

/** The lock-screen card's switch, read on mount and on every return to the app. */
function useLiveActivityOff(): boolean {
  const [off, setOff] = useState(liveActivityOff);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setOff(liveActivityOff());
    });
    return () => subscription.remove();
  }, []);
  return off;
}

/**
 * One line on the record screen when the ride will have no controls outside
 * the app: Android notifications refused, which takes the shade's pause, lap
 * and stop and the recording-stopped notice, or the iOS lock-screen card
 * switched off. It never blocks Start.
 *
 * On Android it also raises the notification dialog on arrival, once ever,
 * when `askOnArrival` says the location question is behind the athlete:
 * Android shows one dialog at a time and at most two for this permission, so
 * the line's Allow is the second ask, made by hand.
 */
export function OutsideAppNotice({ askOnArrival }: { askOnArrival: boolean }) {
  const { t } = useTranslation();
  const { outcome, request } = useNotificationPermission();
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const asked = useRecordingPreferences((s) => s.notificationsAsked);
  const markAsked = useRecordingPreferences((s) => s.markNotificationsAsked);
  const liveActivityIsOff = useLiveActivityOff();
  const [dismissed, setDismissed] = useState(false);
  const android = Platform.OS === 'android';

  useEffect(() => {
    if (!android || !askOnArrival || !isLoaded || asked || outcome !== 'askable') return;
    markAsked();
    request().catch(() => undefined);
  }, [android, askOnArrival, isLoaded, asked, outcome, markAsked, request]);

  const notificationsOff = android && (outcome === 'askable' || outcome === 'blocked');
  if (dismissed || (!notificationsOff && !liveActivityIsOff)) return null;

  const label = notificationsOff
    ? t('recording.notificationsOffNotice')
    : t('recording.liveActivityOffNotice');
  const action =
    notificationsOff && outcome === 'askable' ? (
      <Button
        onPress={() => {
          request().catch(() => undefined);
        }}
        label={t('common.allow')}
        variant="ghost"
        size="sm"
      />
    ) : (
      <OpenSettingsButton testID="record-outside-app-notice-settings" />
    );

  return (
    <InlineNotice
      testID="record-outside-app-notice"
      tone="warning"
      icon={notificationsOff ? 'bell-off-outline' : 'cellphone-lock'}
      title={label}
      action={action}
      onDismiss={() => setDismissed(true)}
    />
  );
}
