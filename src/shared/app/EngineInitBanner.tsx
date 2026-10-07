/**
 * Global banner shown when the Rust route engine fails to initialize.
 * Displays a warning with retry button. Non-dismissible - engine is required
 * for routes, sections, and fitness data.
 *
 * The reason is the engine's, never re-derived here. A database written by a
 * newer build is fixed by updating the app, a file another connection holds
 * fixes itself on the retry, a directory nothing can be written to needs
 * space or permission, and a file whose version records disagree with its
 * tables is kept on the device for someone to look at. The general line stays as the fallback for a reason a
 * shipped build has no string for, which is what an engine newer than the
 * bundle produces.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InitOutcome } from 'veloqrs';

import { useBannerPadsStatusBar } from '@/shared/app/TopSafeAreaContext';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { colors, typography, spacing } from '@/theme';

/**
 * The line each reason names.
 *
 * `Opened` and `NotAttempted` are not failures, and a variant this bundle has
 * no case for is what an engine newer than it produces. Both fall through to
 * the general line rather than rendering a key as text.
 */
function reasonLine(reason: InitOutcome | null) {
  switch (reason) {
    case InitOutcome.Busy:
      return 'engine.initReason.busy';
    case InitOutcome.ForwardSchema:
      return 'engine.initReason.forwardSchema';
    case InitOutcome.StorageUnavailable:
      return 'engine.initReason.storageUnavailable';
    case InitOutcome.Failed:
      return 'engine.initReason.failed';
    case InitOutcome.VersionMismatch:
      return 'engine.initReason.versionMismatch';
    default:
      return 'engine.initFailed';
  }
}

export function EngineInitBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const padsStatusBar = useBannerPadsStatusBar('engineInit');
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

  const reasonKey = reasonLine(initFailureReason);

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View
        style={[
          styles.container,
          { paddingTop: !padsStatusBar ? 0 : insets.top > 0 ? insets.top : spacing.sm },
        ]}
        testID="engine-init-banner"
      >
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={16}
          color={colors.warningBannerText}
        />
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
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
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
