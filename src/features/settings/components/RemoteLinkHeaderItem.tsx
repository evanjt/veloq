import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { openSheet } from '@/shared/app/sheetRequest';
import { IconButton } from '@/shared/ui';
import { colors, darkColors, iconSize, layout, spacing } from '@/theme';
import { useExperimental } from '../lib/experimental';

export type RemoteLinkHeaderState = 'connected' | 'waiting' | 'unreachable';

/**
 * The state the Settings dot shows, or none while the remote link is switched
 * off or no browser is linked. A connected browser wins; otherwise the phone
 * is either waiting in an open room or cannot be reached on the relay.
 */
export function remoteLinkHeaderState(
  status: { connected: number; linked: number; rooms: number },
  switchedOn: boolean
): RemoteLinkHeaderState | null {
  if (!switchedOn || status.linked === 0) return null;
  if (status.connected > 0) return 'connected';
  return status.rooms > 0 ? 'waiting' : 'unreachable';
}

const LABEL_KEYS = {
  connected: 'remoteLink.headerConnected',
  waiting: 'remoteLink.headerWaiting',
  unreachable: 'remoteLink.headerUnreachable',
} as const;

/**
 * The linked browsers' state in the Settings title bar, beside the jobs item:
 * a dot that is green while a browser is connected, amber while the phone
 * waits for one, and grey while it cannot be reached. A tap opens the sheet
 * that names each browser.
 */
export function RemoteLinkHeaderItem() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const switchedOn = useExperimental('remoteLink');
  const connected = useRemoteLinkStatus((s) => s.connected);
  const linked = useRemoteLinkStatus((s) => s.linked);
  const rooms = useRemoteLinkStatus((s) => s.rooms);
  const state = remoteLinkHeaderState({ connected, linked, rooms }, switchedOn);
  if (state === null) return null;

  const palette = isDark ? darkColors : colors;
  const ink =
    state === 'connected'
      ? palette.successText
      : state === 'waiting'
        ? palette.warningText
        : palette.iconSecondary;

  return (
    <IconButton
      testID="remote-link-header-item"
      accessibilityLabel={t(LABEL_KEYS[state])}
      onPress={() => void openSheet<Record<string, never>, never>('sheets/remote-link', {})}
    >
      <View style={styles.glyph}>
        <IconButton.Glyph name="laptop" size={iconSize.md} />
        <View
          testID={`remote-link-header-${state}`}
          style={[styles.dot, { backgroundColor: ink }]}
        />
      </View>
    </IconButton>
  );
}

const styles = StyleSheet.create({
  glyph: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusFull,
  },
});
