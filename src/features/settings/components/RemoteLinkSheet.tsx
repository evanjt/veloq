import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { remote, type FfiLinkedDevice } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { goBack, navigateTo } from '@/shared/app/navigation';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { formatClockOrDate } from '@/shared/format/format';
import { Button, Icon, SheetHeader } from '@/shared/ui';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { disconnectRemoteLink } from '../lib/remoteLinkSession';

/**
 * Every linked browser with whether it is connected and since when, opened from
 * the Settings dot. The list is read again whenever the connected count moves,
 * so a browser that connects or drops while the sheet is open is shown as it
 * happens.
 */
export function RemoteLinkSheet() {
  const { t } = useTranslation();
  const connected = useRemoteLinkStatus((s) => s.connected);
  return (
    <View testID="remote-link-sheet" style={styles.sheet}>
      <SheetHeader
        title={t('remoteLink.sheetTitle')}
        onClose={() => goBack()}
        closeTestID="remote-link-sheet-close"
      />
      <LinkedBrowserList key={connected} connected={connected} />
    </View>
  );
}

function LinkedBrowserList({ connected }: { connected: number }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [devices] = useState<FfiLinkedDevice[]>(() => remote.listLinkedDevices());

  const stateOf = (device: FfiLinkedDevice) =>
    device.connectedSince == null
      ? t('remoteLink.notConnected')
      : t('remoteLink.connectedSince', {
          time: formatClockOrDate(device.connectedSince * 1000),
        });

  const manage = () => {
    goBack();
    navigateTo('/linked-devices');
  };

  return (
    <View style={styles.body}>
      {devices.length === 0 ? (
        <Text style={[styles.detail, { color: palette.textSecondary }]}>
          {t('remoteLink.empty')}
        </Text>
      ) : (
        devices.map((device) => (
          <View
            key={device.id}
            testID={`linked-browser-${device.id}`}
            accessible
            accessibilityLabel={composeAccessibilityLabel(device.name, stateOf(device))}
            style={styles.row}
          >
            <Icon name="laptop" size={iconSize.lg} color={palette.textSecondary} />
            <View style={styles.fill}>
              <Text style={[styles.name, { color: palette.textPrimary }]}>{device.name}</Text>
              <Text style={[styles.detail, { color: palette.textSecondary }]}>
                {stateOf(device)}
              </Text>
            </View>
          </View>
        ))
      )}
      {connected > 0 ? (
        <Button
          label={t('remoteLink.disconnect')}
          onPress={disconnectRemoteLink}
          variant="ghost"
          testID="remote-link-sheet-disconnect"
        />
      ) : null}
      <Button label={t('remoteLink.manage')} onPress={manage} testID="remote-link-sheet-manage" />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingBottom: layout.screenPadding,
  },
  body: {
    paddingHorizontal: layout.screenPadding,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  fill: {
    flex: 1,
  },
  name: {
    ...typography.body,
  },
  detail: {
    ...typography.caption,
  },
});
