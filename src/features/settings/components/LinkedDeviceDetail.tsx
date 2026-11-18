import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  type FfiLinkedClient,
  type FfiLinkedConnection,
  type FfiLinkedDevice,
  type FfiRemoteWrite,
} from 'veloqrs';
import { useTheme } from '@/shared/app';
import { formatDateTime, formatRelativeDateTime } from '@/shared/format';
import { Button, SectionTitle } from '@/shared/ui';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

/** What a client said it is, in the athlete's words. */
function describeClient(client: FfiLinkedClient | undefined, t: TFunction) {
  if (!client) return null;
  if (client.kind === 'tool') {
    return [client.tool, client.toolVersion].filter(Boolean).join(' ') || t('remoteLink.kindTool');
  }
  if (client.browser && client.os) {
    return t('remoteLink.clientOn', { browser: client.browser, os: client.os });
  }
  return client.browser ?? client.os ?? null;
}

/** When a change landed, as the phone reads a day and a time. */
function whenChanged(at: number): string {
  const instant = new Date(at * 1000); // true-instant: a write stamped in Unix seconds
  return formatRelativeDateTime(instant.toISOString());
}

/** Why a connection ended, in words. An unknown reason reads as a plain close. */
function endReasonLabel(reason: string | undefined, t: TFunction): string {
  switch (reason) {
    case 'backgrounded':
      return t('remoteLink.endReason.backgrounded');
    case 'switched_off':
      return t('remoteLink.endReason.switched_off');
    case 'removed':
      return t('remoteLink.endReason.removed');
    case 'disconnected':
      return t('remoteLink.endReason.disconnected');
    case 'refused':
      return t('remoteLink.endReason.refused');
    default:
      return t('remoteLink.endReason.closed');
  }
}

/** One linked client: what it is, what it may do, its connections and its changes. */
export function LinkedDeviceDetail({
  device,
  writes,
  connections,
  onBack,
  onRemove,
}: {
  device: FfiLinkedDevice;
  writes: FfiRemoteWrite[];
  connections: FfiLinkedConnection[];
  onBack: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const self = describeClient(connections[0]?.client, t);
  const muted = [styles.detail, { color: palette.textSecondary }];

  return (
    <View style={styles.page} testID={`linked-device-detail-${device.id}`}>
      <View style={styles.block}>
        <Text style={[styles.name, { color: palette.textPrimary }]}>{device.name}</Text>
        {self ? <Text style={muted}>{self}</Text> : null}
        <Text style={muted}>
          {t('remoteLink.linkedOn', { date: formatDateTime(device.createdAt * 1000) })}
        </Text>
        <Text style={muted}>
          {device.connectedSince != null
            ? t('remoteLink.connectedNow')
            : device.lastSeenAt == null
              ? t('remoteLink.neverSeen')
              : t('remoteLink.lastSeen', { date: formatDateTime(device.lastSeenAt * 1000) })}
        </Text>
        <Text style={[styles.body, { color: palette.textPrimary }]}>{t('remoteLink.scope')}</Text>
      </View>

      <Section title={t('remoteLink.connectionsTitle')}>
        {connections.length === 0 ? (
          <Text style={muted}>{t('remoteLink.noConnections')}</Text>
        ) : (
          connections.map((connection, index) => (
            <View
              key={`${connection.startedAt}-${index}`}
              testID={`linked-connection-${index}`}
              style={styles.entry}
            >
              <Text style={[styles.body, { color: palette.textPrimary }]}>
                {t(connection.thisNetwork ? 'remoteLink.thisNetwork' : 'remoteLink.internet')}
                {' · '}
                {connection.remoteAddress}
              </Text>
              <Text style={muted}>
                {formatDateTime(connection.startedAt * 1000)}
                {connection.endedAt == null
                  ? ` · ${t('remoteLink.connectedNow')}`
                  : ` · ${endReasonLabel(connection.endReason, t)}`}
              </Text>
            </View>
          ))
        )}
      </Section>

      <Section title={t('remoteLink.changesTitle')} testID={`linked-device-writes-${device.id}`}>
        {writes.length === 0 ? (
          <Text style={muted}>{t('remoteLink.noChanges')}</Text>
        ) : (
          writes.map((write, index) => (
            <View key={index} style={styles.entry}>
              <Text style={[styles.body, { color: palette.textPrimary }]}>{write.summary}</Text>
              <Text style={muted}>{whenChanged(write.at)}</Text>
            </View>
          ))
        )}
      </Section>

      <View style={styles.actions}>
        <Button
          label={t('remoteLink.remove')}
          onPress={onRemove}
          testID="linked-device-remove"
          variant="destructive"
        />
        <Button
          label={t('common.back')}
          onPress={onBack}
          variant="ghost"
          testID="linked-device-back"
        />
      </View>
    </View>
  );
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const { isDark } = useTheme();
  return (
    <View style={styles.block} testID={testID}>
      <SectionTitle>{title}</SectionTitle>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <View style={styles.entries}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.md },
  block: { gap: spacing.xs, paddingHorizontal: layout.screenPadding },
  name: { ...typography.body },
  body: { ...typography.bodySmall },
  detail: { ...typography.caption },

  entries: { gap: spacing.sm, padding: spacing.md },
  entry: { gap: spacing.xs },
  actions: { gap: spacing.sm, paddingHorizontal: layout.screenPadding },
});
