/**
 * Global banner shown when the Rust route engine fails to initialize.
 * Displays a warning with retry button. Non-dismissible - engine is required
 * for routes, sections, and fitness data.
 *
 * The reason is the engine's, never re-derived here. A database written by a
 * newer build is fixed by updating the app, a file another connection holds
 * fixes itself on the retry, and a directory nothing can be written to needs
 * space or permission. The general line stays as the fallback for a reason a
 * shipped build has no string for, which is what an engine newer than the
 * bundle produces.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { InitOutcome } from 'veloqrs';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { colors, typography } from '@/theme';

/** The line each reason names. `Opened` and `NotAttempted` are not failures. */
const REASON_KEY: Partial<Record<InitOutcome, string>> = {
  [InitOutcome.Busy]: 'engine.initReason.busy',
  [InitOutcome.ForwardSchema]: 'engine.initReason.forwardSchema',
  [InitOutcome.StorageUnavailable]: 'engine.initReason.storageUnavailable',
  [InitOutcome.Failed]: 'engine.initReason.failed',
};

export function EngineInitBanner() {
  const { t } = useTranslation();
  const initFailed = useEngineStatus((s) => s.initFailed);
  const initFailureReason = useEngineStatus((s) => s.initFailureReason);
  const requestRetry = useEngineStatus((s) => s.requestRetry);

  const handleRetry = useCallback(() => {
    // Re-runs the root layout's full init effect (open, identity check,
    // post-init setup), not just a bare re-open.
    requestRetry();
  }, [requestRetry]);

  if (!initFailed) {
    return null;
  }

  const reasonKey =
    (initFailureReason === null ? undefined : REASON_KEY[initFailureReason]) ?? 'engine.initFailed';

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View style={styles.container} testID="engine-init-banner">
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.warning} />
        <Text style={styles.text}>{t(reasonKey)}</Text>
        <IconButton
          icon="refresh"
          size={16}
          iconColor={colors.warning}
          onPress={handleRetry}
          style={styles.retryButton}
          testID="engine-retry-button"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.warningBannerBg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  text: {
    flex: 1,
    color: colors.warningBannerText,
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: 18,
  },
  retryButton: {
    margin: 0,
  },
});
