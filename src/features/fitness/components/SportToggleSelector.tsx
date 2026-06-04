import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { SPORT_COLORS, type PrimarySport } from '@/providers';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';

const SPORTS = ['Cycling', 'Running', 'Swimming'] as const;

interface SportToggleSelectorProps {
  sportMode: PrimarySport;
  onSportModeChange: (sport: PrimarySport) => void;
  isDark: boolean;
}

/**
 * Pill-button group for selecting the active fitness sport (Cycling/Running/Swimming).
 * Extracted from FitnessScreen — uses `SPORT_COLORS` from `@/providers`.
 */
export const SportToggleSelector = React.memo(function SportToggleSelector({
  sportMode,
  onSportModeChange,
  isDark,
}: SportToggleSelectorProps) {
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.sportToggleContainer}>
      {SPORTS.map((sport) => (
        <TouchableOpacity
          key={sport}
          testID={`fitness-sport-toggle-${sport}`}
          style={[
            styles.sportToggleButton,
            isDark && styles.sportToggleButtonDark,
            sportMode === sport && {
              backgroundColor: SPORT_COLORS[sport],
            },
          ]}
          onPress={() => onSportModeChange(sport)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name={sport === 'Cycling' ? 'bike' : sport === 'Running' ? 'run' : 'swim'}
            size={16}
            color={sportMode === sport ? colors.textOnDark : themeColors.textSecondary}
          />
          <Text
            style={[
              styles.sportToggleText,
              isDark && styles.sportToggleTextDark,
              sportMode === sport && styles.sportToggleTextActive,
            ]}
          >
            {t(`filters.${sport.toLowerCase()}` as never)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  sportToggleContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sportToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.light,
    gap: 6,
  },
  sportToggleButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  sportToggleText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sportToggleTextDark: {
    color: darkColors.textSecondary,
  },
  sportToggleTextActive: {
    color: colors.textOnDark,
  },
});
