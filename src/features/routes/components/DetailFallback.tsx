/**
 * Fallback screen for route/section detail: skeleton while the engine is
 * still initialising, EmptyState once it is ready and the item is missing.
 */

import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ChartSkeleton, EmptyState } from '@/shared/ui';
import { colors, darkColors, opacity, spacing } from '@/theme';

interface DetailFallbackProps {
  isDark: boolean;
  insetTop: number;
  onBack: () => void;
  /** True while the engine has not initialised yet; false means not found. */
  loading: boolean;
  notFoundMessage: string;
}

export function DetailFallback({
  isDark,
  insetTop,
  onBack,
  loading,
  notFoundMessage,
}: DetailFallbackProps) {
  const { t } = useTranslation();

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.floatingHeader, { paddingTop: insetTop }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={isDark ? colors.textOnDark : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.skeletonWrap}>
          <ChartSkeleton height={280} />
          <ChartSkeleton height={200} />
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          <EmptyState icon="map-marker-question-outline" title={notFoundMessage} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  floatingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: opacity.overlay.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skeletonWrap: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
});
