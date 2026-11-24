import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { remote, type FfiLinkedDevice, type FfiLinkedDevicesScreen } from 'veloqrs';
import { useTheme } from '@/shared/app';
import { formatDateTime } from '@/shared/format';
import { getEngine } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { Button, Icon, ROW_DIVIDER_INSET, Row, RowGroup, Spinner, TextField } from '@/shared/ui';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { confirmAction } from '@/shared/ui/dialog';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { useDevicePairing } from '../hooks/useDevicePairing';
import { remoteLink } from '../lib/remoteLinkSession';
import { LinkedDeviceDetail } from './LinkedDeviceDetail';
import { QrScanner } from './QrScanner';
import { settingsStyles } from './settingsStyles';

/** The connections the detail lists, newest first. */
const CONNECTIONS_LISTED = 20;

/** The changes each browser's detail lists, newest first. */
const CHANGES_LISTED = 5;

/** What Connect does, one plain line each, shown from "How Connect works". */
const HOW_KEYS = [
  'remoteLink.howLinked',
  'remoteLink.howPrivate',
  'remoteLink.howRelay',
  'remoteLink.howAccess',
] as const;

function readScreen(): FfiLinkedDevicesScreen {
  return remote.linkedDevicesScreen(CHANGES_LISTED, CONNECTIONS_LISTED);
}

/** The browsers linked to this library, with remove, and the way to link one more. */
export function LinkedDevices({ inviteCode }: { inviteCode?: string | undefined }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const ready = useEngineReady();
  const [screen, setScreen] = useState<FfiLinkedDevicesScreen>(readScreen);
  const { browsers, refusedToday } = screen;
  const [openId, setOpenId] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const reload = useCallback(() => {
    setScreen(readScreen());
    remoteLink.refresh();
  }, []);
  const pairing = useDevicePairing(reload, inviteCode);

  useEffect(() => {
    const engine = getEngine();
    if (!ready || !engine) return undefined;
    return engine.subscribe('remoteWrote', () => setScreen(readScreen()));
  }, [ready]);

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const disconnect = (device: FfiLinkedDevice) => {
    remote.disconnectLinkedDevice(device.id);
    reload();
  };

  const saveRename = (device: FfiLinkedDevice, name: string) => {
    remote.renameLinkedDevice(device.id, name.trim());
    setRenaming(null);
    reload();
  };

  const askRemove = (device: FfiLinkedDevice) =>
    confirmAction({
      title: t('remoteLink.removeTitle', { name: device.name }),
      message: t('remoteLink.removeMessage'),
      confirmLabel: t('remoteLink.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => {
        remote.removeLinkedDevice(device.id);
        setOpenId(null);
        reload();
      },
    });

  const state = (device: FfiLinkedDevice) =>
    device.connectedSince != null ? t('remoteLink.connectedNow') : seen(device);

  const seen = (device: FfiLinkedDevice) =>
    device.lastSeenAt == null
      ? t('remoteLink.neverSeen')
      : t('remoteLink.lastSeen', { date: formatDateTime(device.lastSeenAt * 1000) });

  const open = browsers.find(({ device }) => device.id === openId);
  if (open) {
    return (
      <View style={styles.page}>
        <LinkedDeviceDetail
          device={open.device}
          writes={open.writes}
          connections={open.connections}
          onBack={() => setOpenId(null)}
          onRemove={() => askRemove(open.device)}
        />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Text style={[styles.intro, { color: palette.textSecondary }]}>{t('remoteLink.intro')}</Text>
      {refusedToday > 0 ? (
        <Text
          style={[styles.intro, { color: palette.textSecondary }]}
          testID="remote-link-refused-today"
        >
          {t('remoteLink.refusedToday', { count: refusedToday })}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={t('remoteLink.howTitle')}
          onPress={() => setExplaining((v) => !v)}
          variant="ghost"
          testID="remote-link-how"
        />
        {explaining
          ? HOW_KEYS.map((key) => (
              <Text key={key} style={[styles.detail, { color: palette.textPrimary }]}>
                {t(key)}
              </Text>
            ))
          : null}
      </View>

      {browsers.length > 0 ? (
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            {browsers.map(({ device }) => (
              <View key={device.id}>
                <Row
                  testID={`linked-device-${device.id}`}
                  behaviour="navigate"
                  onPress={() => setOpenId(device.id)}
                  accessibilityLabel={composeAccessibilityLabel(device.name, state(device))}
                >
                  <Icon name="laptop" size={iconSize.lg} color={palette.textSecondary} />
                  <View style={styles.fill}>
                    <Text style={[styles.name, { color: palette.textPrimary }]}>{device.name}</Text>
                    <Text style={[styles.detail, { color: palette.textSecondary }]}>
                      {state(device)}
                    </Text>
                  </View>
                </Row>
                {renaming?.id === device.id ? (
                  <View style={styles.rename}>
                    <TextField
                      label={t('remoteLink.renameLabel')}
                      value={renaming.name}
                      onChangeText={(name) => setRenaming({ id: device.id, name })}
                      testID={`linked-device-rename-field-${device.id}`}
                    />
                    <View style={styles.buttons}>
                      <Button
                        label={t('common.cancel')}
                        variant="ghost"
                        onPress={() => setRenaming(null)}
                        testID={`linked-device-rename-cancel-${device.id}`}
                      />
                      <Button
                        label={t('common.save')}
                        disabled={renaming.name.trim() === ''}
                        onPress={() => saveRename(device, renaming.name)}
                        testID={`linked-device-rename-save-${device.id}`}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.buttons}>
                    <Button
                      label={t('remoteLink.rename')}
                      variant="ghost"
                      onPress={() => setRenaming({ id: device.id, name: device.name })}
                      testID={`linked-device-rename-${device.id}`}
                    />
                    {device.connectedSince != null ? (
                      <Button
                        label={t('remoteLink.disconnect')}
                        variant="ghost"
                        onPress={() => disconnect(device)}
                        testID={`linked-device-disconnect-${device.id}`}
                      />
                    ) : null}
                  </View>
                )}
              </View>
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
  rename: {
    gap: spacing.sm,
    paddingLeft: ROW_DIVIDER_INSET,
    paddingRight: spacing.md,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingRight: spacing.md,
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
