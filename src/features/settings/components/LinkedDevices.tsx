import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { remote, type FfiLinkedDevice } from 'veloqrs';
import { useTheme } from '@/shared/app';
import { formatDateTime } from '@/shared/format';
import { Button, Icon, Row, RowGroup, Spinner } from '@/shared/ui';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { confirmAction } from '@/shared/ui/dialog';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { useDevicePairing } from '../hooks/useDevicePairing';
import { remoteLink } from '../lib/remoteLinkSession';
import { QrScanner } from './QrScanner';
import { settingsStyles } from './settingsStyles';

/** The browsers linked to this library, with remove, and the way to link one more. */
export function LinkedDevices() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [devices, setDevices] = useState<FfiLinkedDevice[]>(() => remote.listLinkedDevices());

  const reload = useCallback(() => {
    setDevices(remote.listLinkedDevices());
    remoteLink.refresh();
  }, []);
  const pairing = useDevicePairing(reload);

  const askRemove = (device: FfiLinkedDevice) =>
    confirmAction({
      title: t('remoteLink.removeTitle', { name: device.name }),
      message: t('remoteLink.removeMessage'),
      confirmLabel: t('remoteLink.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => {
        remote.removeLinkedDevice(device.id);
        reload();
      },
    });

  const seen = (device: FfiLinkedDevice) =>
    device.lastSeenAt == null
      ? t('remoteLink.neverSeen')
      : t('remoteLink.lastSeen', { date: formatDateTime(device.lastSeenAt * 1000) });

  return (
    <View style={styles.page}>
      <Text style={[styles.intro, { color: palette.textSecondary }]}>{t('remoteLink.intro')}</Text>

      {devices.length > 0 ? (
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            {devices.map((device) => (
              <Row
                key={device.id}
                testID={`linked-device-${device.id}`}
                behaviour="act"
                onPress={() => askRemove(device)}
                accessibilityLabel={composeAccessibilityLabel(
                  device.name,
                  seen(device),
                  t('remoteLink.remove')
                )}
              >
                <Icon name="laptop" size={iconSize.lg} color={palette.textSecondary} />
                <View style={styles.fill}>
                  <Text style={[styles.name, { color: palette.textPrimary }]}>{device.name}</Text>
                  <Text style={[styles.detail, { color: palette.textSecondary }]}>
                    {seen(device)}
                  </Text>
                </View>
                <Icon name="close" size={iconSize.md} color={palette.textSecondary} />
              </Row>
            ))}
          </RowGroup>
        </View>
      ) : (
        <Text style={[styles.empty, { color: palette.textSecondary }]}>
          {t('remoteLink.empty')}
        </Text>
      )}

      {pairing.phase === 'waiting' ? (
        <View style={styles.waiting} testID="remote-link-waiting">
          <Spinner label={t('remoteLink.waiting')} />
          <Text style={[styles.detail, { color: palette.textSecondary }]}>
            {t('remoteLink.waiting')}
          </Text>
          <Button label={t('common.cancel')} onPress={pairing.cancel} variant="ghost" />
        </View>
      ) : (
        <View style={styles.actions}>
          {pairing.phase === 'expired' ? (
            <Text style={[styles.detail, { color: palette.textSecondary }]}>
              {t('remoteLink.expired')}
            </Text>
          ) : null}
          <Button label={t('remoteLink.link')} onPress={pairing.scan} testID="remote-link-link" />
        </View>
      )}

      <FullWindowModal
        visible={pairing.phase === 'scanning'}
        animationType="slide"
        onRequestClose={pairing.cancel}
      >
        <QrScanner
          read={pairing.read}
          title={t('remoteLink.scanTitle')}
          instructions={t('remoteLink.scanInstructions')}
          mismatch={t('remoteLink.invalidCode')}
          onClose={pairing.cancel}
          testID="remote-link-scanner-camera"
        />
      </FullWindowModal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  intro: {
    ...typography.bodySmall,
    paddingHorizontal: layout.screenPadding,
  },
  empty: {
    ...typography.body,
    paddingHorizontal: layout.screenPadding,
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
  waiting: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
  },
  actions: {
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
  },
});
