/**
 * Global banner shown when the Rust route engine fails to initialize.
 * Displays a warning with retry button. Non-dismissible — engine is required
 * for routes, sections, and fitness data.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useEngineStatus } from '@/providers';
import { getRouteEngine, getRouteDbPath } from '@/lib/native/routeEngine';
import { colors } from '@/theme';

export function EngineInitBanner() {
  const { t } = useTranslation();
  const initFailed = useEngineStatus((s) => s.initFailed);
  const setInitFailed = useEngineStatus((s) => s.setInitFailed);

  const handleRetry = useCallback(() => {
    const engine = getRouteEngine();
    const dbPath = getRouteDbPath();
    if (engine && dbPath) {
      const success = engine.initWithPath(dbPath);
      if (success) {
        setInitFailed(false);
      }
    }
  }, [setInitFailed]);

  if (!initFailed) {
    return null;
  }

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View style={styles.container} testID="engine-init-banner">
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.warning} />
        <Text style={styles.text}>{t('engine.initFailed')}</Text>
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
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    margin: 0,
  },
});
