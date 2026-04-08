import React from 'react';
import { Modal, View, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/hooks';
import { colors, darkColors, spacing, typography, brand } from '@/theme';
import type { MuscleGroupDetail } from '@/hooks/activities/useMuscleDetail';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.55;
const PRIMARY_COLOR = brand.orange;
const SECONDARY_COLOR = brand.orangeLight;

interface MuscleDetailSheetProps {
  detail: MuscleGroupDetail | null;
  visible: boolean;
  onClose: () => void;
}

function formatWeight(kg: number, isMetric: boolean): string {
  if (isMetric) {
    return kg % 1 === 0 ? `${kg} kg` : `${kg.toFixed(1)} kg`;
  }
  const lbs = kg * 2.20462;
  return lbs % 1 === 0 ? `${lbs} lbs` : `${lbs.toFixed(1)} lbs`;
}

export const MuscleDetailSheet = React.memo(function MuscleDetailSheet({
  detail,
  visible,
  onClose,
}: MuscleDetailSheetProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  if (!detail) return null;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.backdropFill} />
      </Pressable>
      <View
        style={[styles.sheet, isDark && styles.sheetDark, { height: SHEET_HEIGHT }]}
        testID="muscle-detail-sheet"
      >
        {/* Drag handle */}
        <View style={styles.handleContainer}>
          <View style={[styles.handle, isDark && styles.handleDark]} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.roleDot,
                  {
                    backgroundColor: detail.primaryExercises > 0 ? PRIMARY_COLOR : SECONDARY_COLOR,
                  },
                ]}
              />
              <Text style={[styles.title, isDark && styles.titleDark]}>{detail.name}</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons
                name="close"
                size={20}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </Pressable>
          </View>

          {/* Summary stats */}
          <View style={[styles.statsRow, isDark && styles.statsRowDark]}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.statValueDark]}>
                {detail.totalSets}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('activity.muscle.sets')}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.statValueDark]}>
                {detail.totalReps}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('activity.muscle.reps')}
              </Text>
            </View>
            {detail.totalVolumeKg > 0 && (
              <View style={styles.stat}>
                <Text style={[styles.statValue, isDark && styles.statValueDark]}>
                  {formatWeight(Math.round(detail.totalVolumeKg), isMetric)}
                </Text>
                <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                  {t('activity.muscle.volume')}
                </Text>
              </View>
            )}
          </View>

          {/* Exercise list */}
          <View style={styles.exerciseSection}>
            <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>
              {t('activity.muscle.contributingExercises')}
            </Text>

            {detail.exercises.map((ex, idx) => (
              <View
                key={`${ex.name}-${idx}`}
                style={[
                  styles.exerciseRow,
                  idx > 0 && styles.exerciseRowBorder,
                  idx > 0 && isDark && styles.exerciseRowBorderDark,
                ]}
              >
                <View style={styles.exerciseHeader}>
                  <View style={styles.exerciseNameRow}>
                    <View
                      style={[
                        styles.roleIndicator,
                        {
                          backgroundColor: ex.role === 'primary' ? PRIMARY_COLOR : SECONDARY_COLOR,
                        },
                      ]}
                    />
                    <Text style={[styles.exerciseName, isDark && styles.exerciseNameDark]}>
                      {ex.name}
                    </Text>
                  </View>
                  <Text style={[styles.roleLabel, isDark && styles.roleLabelDark]}>{ex.role}</Text>
                </View>
                <View style={styles.exerciseStats}>
                  <Text style={[styles.exerciseStat, isDark && styles.exerciseStatDark]}>
                    {t('activity.muscle.setCount', { count: ex.sets })}
                  </Text>
                  <Text style={[styles.exerciseStatSep, isDark && styles.exerciseStatSepDark]}>
                    ·
                  </Text>
                  <Text style={[styles.exerciseStat, isDark && styles.exerciseStatDark]}>
                    {t('activity.muscle.repsCount', { count: ex.reps })}
                  </Text>
                  {ex.volumeKg > 0 && (
                    <>
                      <Text style={[styles.exerciseStatSep, isDark && styles.exerciseStatSepDark]}>
                        ·
                      </Text>
                      <Text style={[styles.exerciseStat, isDark && styles.exerciseStatDark]}>
                        {formatWeight(Math.round(ex.volumeKg), isMetric)}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  backdropFill: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetDark: {
    backgroundColor: darkColors.surface,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray300,
  },
  handleDark: {
    backgroundColor: darkColors.borderLight,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  roleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.background,
    justifyContent: 'space-around',
  },
  statsRowDark: {
    backgroundColor: darkColors.background,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueDark: {
    color: darkColors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statLabelDark: {
    color: darkColors.textSecondary,
  },
  exerciseSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionTitleDark: {
    color: darkColors.textSecondary,
  },
  exerciseRow: {
    paddingVertical: spacing.sm,
  },
  exerciseRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  exerciseRowBorderDark: {
    borderTopColor: darkColors.border,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  roleIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  exerciseNameDark: {
    color: darkColors.textPrimary,
  },
  roleLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  roleLabelDark: {
    color: darkColors.textSecondary,
  },
  exerciseStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingLeft: 12,
  },
  exerciseStat: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  exerciseStatDark: {
    color: darkColors.textSecondary,
  },
  exerciseStatSep: {
    fontSize: 13,
    color: colors.textDisabled,
    paddingHorizontal: 6,
  },
  exerciseStatSepDark: {
    color: darkColors.textMuted,
  },
});
