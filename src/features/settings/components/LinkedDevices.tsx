import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { remote, type FfiLinkedDevice, type FfiRemoteWrite } from 'veloqrs';
import { useTheme } from '@/shared/app';
import { formatDateTime, formatRelativeDateTime } from '@/shared/format';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { Button, Icon, ROW_DIVIDER_INSET, Row, RowGroup, Spinner } from '@/shared/ui';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { confirmAction } from '@/shared/ui/dialog';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { useDevicePairing } from '../hooks/useDevicePairing';
import { remoteLink } from '../lib/remoteLinkSession';
import { QrScanner } from './QrScanner';
import { settingsStyles } from './settingsStyles';

/** The changes each browser's row lists, newest first. */
const CHANGES_LISTED = 5;

/** A linked browser, with the changes it made most recently, newest first. */
interface LinkedBrowser {
  device: FfiLinkedDevice;
  writes: FfiRemoteWrite[];
}

function readBrowsers(): LinkedBrowser[] {
  return remote
    .listLinkedDevices()
    .map((device) => ({ device, writes: remote.recentWrites(device.id, CHANGES_LISTED) }));
}

/** When a change landed, as the phone reads a day and a time. */
function whenChanged(at: number): string {
  const instant = new Date(at * 1000); // true-instant: a write stamped in Unix seconds
  return formatRelativeDateTime(instant.toISOString());
}

/** The browsers linked to this library, with remove, and the way to link one more. */
export function LinkedDevices() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const engine = useEngineReady();
  const [browsers, setBrowsers] = useState<LinkedBrowser[]>(readBrowsers);

  const reload = useCallback(() => {
    setBrowsers(readBrowsers());
    remoteLink.refresh();
  }, []);
  const pairing = useDevicePairing(reload);

  useEffect(() => {
    if (!engine) return undefined;
    return engine.subscribe('remoteWrote', () => setBrowsers(readBrowsers()));
  }, [engine]);

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

      {browsers.length > 0 ? (
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            {browsers.map(({ device, writes }) => (
              <View key={device.id}>
                <Row
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
                <View style={styles.changes} testID={`linked-device-writes-${device.id}`}>
                  {writes.length === 0 ? (
                    <Text style={[styles.detail, { color: palette.textSecondary }]}>
                      {t('remoteLink.noChanges')}
                    </Text>
                  ) : (
                    writes.map((write, index) => (
                      <View key={index} style={styles.change}>
                        <Text style={[styles.changeText, { color: palette.textPrimary }]}>
                          {write.summary}
                        </Text>
                        <Text style={[styles.detail, { color: palette.textSecondary }]}>
                          {whenChanged(write.at)}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
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
  changes: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingLeft: ROW_DIVIDER_INSET,
    paddingRight: spacing.md,
  },
  change: {
    gap: spacing.xs,
  },
  changeText: {
    ...typography.bodySmall,
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
