import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';

export interface TileCachePanelProps {
  isDark: boolean;
  routeMatchingEnabled: boolean;
  onRouteMatchingChange: (enabled: boolean) => void;
}

export function TileCachePanel({
  isDark,
  routeMatchingEnabled,
  onRouteMatchingChange,
}: TileCachePanelProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Route Matching Toggle */}
      <View testID="settings-tile-cache" style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={[styles.toggleLabel, isDark && styles.textLight]}>
            {t('settings.enableRouteMatching')}
          </Text>
          <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
            {t('settings.routeMatchingDescription')}
          </Text>
        </View>
        <Switch
          value={routeMatchingEnabled}
          onValueChange={onRouteMatchingChange}
          color={colors.primary}
        />
      </View>

      <Text style={[styles.infoTextInline, isDark && styles.textMuted]}>
        {t('settings.cacheHint')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toggleInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  infoTextInline: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    lineHeight: 18,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
