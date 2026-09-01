import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { darkColors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export const TERRAIN_UNAVAILABLE_TEST_ID = 'terrain-unavailable-notice';

const DISMISS_AFTER_MS = 6000;

/**
 * Says why a 3D view dropped back to the flat map. The renderer ships in the
 * app but the DEM tiles do not, so an offline 3D open used to leave a flat map
 * that read as broken 3D (`B131`).
 *
 * It clears itself, because the athlete cannot act on it while offline and a
 * pill that has to be dismissed is worse than the silence it replaced.
 */
export function TerrainUnavailableNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <Pressable style={styles.wrapper} onPress={onDismiss} testID={TERRAIN_UNAVAILABLE_TEST_ID}>
      <View style={styles.pill}>
        <MaterialCommunityIcons name="terrain" size={16} color={darkColors.textSecondary} />
        <Text style={styles.text}>{t('maps.threeDUnavailable')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    backgroundColor: darkColors.surfaceElevated,
  },
  text: {
    ...typography.bodySmall,
    color: darkColors.textPrimary,
    flexShrink: 1,
  },
});
