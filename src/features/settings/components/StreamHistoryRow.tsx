/**
 * How much stream history the athlete keeps, and what it costs.
 *
 * `Q31` asked for the control, the readout, a 90 day default and a reset that
 * clears the excess. The engine owns all four: setting the window prunes on
 * the way in, so the size is re-read after every write rather than adjusted
 * here. Widening never shows a gap, the detail screen refetches a series the
 * store no longer holds.
 *
 * The row is a cycle, not a slider, because the tile cache limit two rows above
 * it is already one and two controls of the same kind should not read
 * differently.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { formatFileSize } from '@/shared/format/format';
import { getEngine } from '@/shared/native/engine';
import { colors, darkColors, spacing } from '@/theme';

import {
  DEFAULT_STREAM_RETENTION_DAYS,
  STREAM_RETENTION_ALL,
  nextStreamRetentionDays,
} from '../lib/streamRetention';

export {
  STREAM_RETENTION_CHOICES_DAYS,
  DEFAULT_STREAM_RETENTION_DAYS,
} from '../lib/streamRetention';

interface StreamHistoryRowProps {
  isDark: boolean;
}

interface StreamStore {
  days: number;
  bytes: number;
}

/**
 * What the engine holds, or null while it cannot answer. An unopened engine
 * reports no window at all, and rendering the default then would show a
 * setting nobody has made.
 */
function readStore(): StreamStore | null {
  const engine = getEngine();
  if (!engine) return null;
  const days = engine.streamRetentionDays();
  if (days === undefined) return null;
  return { days, bytes: engine.streamStoreBytes() };
}

export function StreamHistoryRow({ isDark }: StreamHistoryRowProps) {
  const { t } = useTranslation();
  const readyNonce = useEngineStatus((s) => s.readyNonce);
  const [store, setStore] = useState(readStore);
  const [readAt, setReadAt] = useState(readyNonce);

  // This row can mount before the root layout has opened the engine, so the
  // first read reaches a closed handle. Re-reading on the ready nonce during
  // render, rather than from an effect, keeps it to one pass.
  if (store === null && readAt !== readyNonce) {
    setReadAt(readyNonce);
    setStore(readStore());
  }

  const write = useCallback((next: number) => {
    const engine = getEngine();
    if (!engine) return;
    engine.setStreamRetentionDays(next);
    setStore(readStore());
  }, []);

  if (store === null) return null;
  const { days, bytes } = store;

  const windowLabel =
    days === STREAM_RETENTION_ALL
      ? t('settings.streamHistoryAll')
      : t('settings.streamHistoryDays', { count: days });

  return (
    <View testID="settings-stream-history" style={[styles.infoRow, isDark && styles.infoRowDark]}>
      <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
        {t('settings.streamHistory')}
      </Text>
      <View style={styles.infoValueRow}>
        <Text testID="settings-stream-bytes" style={[styles.infoValue, isDark && styles.textLight]}>
          {formatFileSize(bytes)}
        </Text>
        {days !== DEFAULT_STREAM_RETENTION_DAYS && (
          <TouchableOpacity
            testID="settings-stream-reset"
            onPress={() => write(DEFAULT_STREAM_RETENTION_DAYS)}
            style={styles.resetButton}
            accessibilityRole="button"
          >
            <Text style={styles.resetText}>{t('settings.streamHistoryReset')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => write(nextStreamRetentionDays(days))}
          accessibilityRole="button"
        >
          <Text testID="settings-stream-window" style={[styles.infoValue, styles.valueClickable]}>
            {`${windowLabel} ›`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowDark: {
    borderTopColor: darkColors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueClickable: {
    color: colors.primary,
  },
  resetButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  resetText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
