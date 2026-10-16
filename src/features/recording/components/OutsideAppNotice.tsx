import React, { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useNotificationPermission } from '@/shared/app/permissions/notifications';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { OpenSettingsButton } from '@/shared/ui/PermissionNotice';
import { SignalStatus, signalColor } from '@/shared/ui/SignalStatus';
import { iconSize, layout, spacing } from '@/theme';
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
  const { isDark } = useTheme();
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
    <View style={styles.line}>
      <View style={styles.body}>
        <SignalStatus
          testID="record-outside-app-notice"
          variant="line"
          level="warn"
          icon={notificationsOff ? 'bell-off-outline' : 'cellphone-lock'}
          label={label}
        >
          {action}
        </SignalStatus>
      </View>
      <IconButton
        testID="record-outside-app-notice-dismiss"
        onPress={() => setDismissed(true)}
        accessibilityLabel={t('common.close')}
      >
        <MaterialCommunityIcons
          name="close"
          size={iconSize.md}
          color={signalColor('warn', isDark)}
        />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
    paddingRight: spacing.xs,
  },
  body: {
    flex: 1,
  },
});
