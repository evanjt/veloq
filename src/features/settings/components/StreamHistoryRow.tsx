/**
 * How much stream history the athlete keeps, and what it costs.
 *
 * The control, the readout, a keep-everything default and a reset that returns
 * to it by opening the window all the way, which prunes nothing. The engine
 * owns all four: narrowing the window prunes on the way in, so the size is
 * re-read after every write rather than adjusted here.
 *
 * Narrowing does not cost the athlete a chart. A series outside the window is
 * refetched when they open the activity and drawn off the cached body, it is
 * simply never kept. What it does cost is anything computed from the durable
 * store, which is why an old lap has no heart rate on it.
 *
 * The row is a cycle, not a slider, because the tile cache limit two rows above
 * it is already one and two controls of the same kind should not read
 * differently.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatFileSize } from '@/shared/format/format';
import { getEngine } from '@/shared/native/engine';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { engineErrorKey, engineErrorTag, type EngineFailureKey } from '@/shared/native/engineError';
import { colors, darkColors, spacing, typography } from '@/theme';

import {
  DEFAULT_STREAM_RETENTION_DAYS,
  STREAM_RETENTION_ALL,
  nextStreamRetentionDays,
} from '../lib/streamRetention';

import { Button, Row } from '@/shared/ui';

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

/** A read that failed, named, so the readout never shows it as an empty store. */
interface StreamStoreFailure {
  failureKey: EngineFailureKey;
}

/**
 * What the engine holds, or null while it is not open. An unopened engine
 * reports no window at all, and rendering the default then would show a
 * setting nobody has made. A failed read is its own answer, since 0 B reads as
 * an empty store.
 */
function readStore(): StreamStore | StreamStoreFailure | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    const data = engine.getCacheScreenData();
    if (!data) return null;
    return { days: data.streamRetentionDays, bytes: data.streamStoreBytes };
  } catch (error) {
    console.warn(
      '[StreamHistory] Could not read the stream store:',
      engineErrorTag(error) ?? error
    );
    return { failureKey: engineErrorKey(error, 'engine.failure.database') };
  }
}

export function StreamHistoryRow({ isDark }: StreamHistoryRowProps) {
  const { t } = useTranslation();
  const readScreen = useEngineRead(['cutoverSettled']);
  const [store, setStore] = useState(readStore);
  const [readAt, setReadAt] = useState(() => readScreen);

  // A ready engine or settled cutover replaces the screen snapshot.
  if (readAt !== readScreen) {
    setReadAt(() => readScreen);
    setStore(readStore());
  }

  const write = useCallback((next: number) => {
    const engine = getEngine();
    if (!engine) return;
    engine.setStreamRetentionDays(next);
    setStore(readStore());
  }, []);

  if (store === null) return null;
  if ('failureKey' in store) {
    return (
      <Row testID="settings-stream-history">
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, isDark && styles.textSecondary]}>
            {t('settings.streamHistory')}
          </Text>
          <Text
            testID="settings-stream-failed"
            style={[styles.failure, isDark && styles.textSecondary]}
            numberOfLines={2}
          >
            {t(store.failureKey)}
          </Text>
        </View>
      </Row>
    );
  }
  const { days, bytes } = store;

  const windowLabel =
    days === STREAM_RETENTION_ALL
      ? t('settings.streamHistoryAll')
      : t('settings.streamHistoryDays', { count: days });

  return (
    <Row testID="settings-stream-history">
      <View style={styles.infoRow}>
        <Text style={[styles.infoLabel, isDark && styles.textSecondary]}>
          {t('settings.streamHistory')}
        </Text>
        <View style={styles.infoValueRow}>
          <Text
            testID="settings-stream-bytes"
            style={[styles.infoValue, isDark && styles.textLight]}
          >
            {formatFileSize(bytes)}
          </Text>
          {days !== DEFAULT_STREAM_RETENTION_DAYS && (
            <Button
              testID="settings-stream-reset"
              label={t('settings.streamHistoryReset')}
              onPress={() => write(DEFAULT_STREAM_RETENTION_DAYS)}
              variant="ghost"
              size="sm"
            />
          )}
          <Button
            labelTestID="settings-stream-window"
            label={`${windowLabel} ›`}
            onPress={() => write(nextStreamRetentionDays(days))}
            variant="ghost"
            size="sm"
          />
        </View>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  infoRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  failure: {
    flexShrink: 1,
    marginLeft: spacing.sm,
    textAlign: 'right',
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
