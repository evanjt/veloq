/**
 * Modal for displaying detailed stat information.
 */

import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, typography, spacing, layout } from '@/theme';
import type { StatDetail } from './types';

interface StatDetailModalProps {
  stat: StatDetail | null;
  isDark: boolean;
  onClose: () => void;
}

export function StatDetailModal({ stat, isDark, onClose }: StatDetailModalProps) {
  const { t } = useTranslation();

  return (
    <Modal visible={stat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
          {stat && (
            <>
              {/* Header */}
              <View style={styles.modalHeader}>
                <View style={[styles.modalIconContainer, { backgroundColor: `${stat.color}20` }]}>
                  <MaterialCommunityIcons name={stat.icon} size={28} color={stat.color} />
                </View>
                <View style={styles.modalHeaderText}>
                  <Text style={[styles.modalValue, isDark && styles.textLight]}>{stat.value}</Text>
                  <Text style={[styles.modalTitle, isDark && styles.textLight]}>{stat.title}</Text>
                </View>
              </View>

              {/* Context */}
              {stat.context && (
                <View style={[styles.contextBanner, { backgroundColor: `${stat.color}15` }]}>
                  <Text style={[styles.contextBannerText, { color: stat.color }]}>
                    {stat.context}
                  </Text>
                </View>
              )}

              {/* Explanation - What does this mean? */}
              {stat.explanation && (
                <View style={styles.explanationBox}>
                  <View style={styles.explanationHeader}>
                    <MaterialCommunityIcons
                      name="information-outline"
                      size={16}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.explanationTitle}>{t('activity.whatIsThis')}</Text>
                  </View>
                  <Text style={styles.explanationText}>{stat.explanation}</Text>
                </View>
              )}

              {/* Details */}
              {stat.details && stat.details.length > 0 && (
                <View style={styles.detailsList}>
                  {stat.details.map((detail, i) => (
                    <View key={i} style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{detail.label}</Text>
                      <Text style={[styles.detailValue, isDark && styles.textLight]}>
                        {detail.value}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Comparison */}
              {stat.comparison && (
                <View style={styles.comparisonSection}>
                  <Text style={styles.comparisonLabel}>{stat.comparison.label}</Text>
                  <View
                    style={[
                      styles.comparisonLarge,
                      stat.comparison.isGood === true && styles.comparisonGood,
                      stat.comparison.isGood === false && styles.comparisonBad,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={
                        stat.comparison.trend === 'up'
                          ? 'trending-up'
                          : stat.comparison.trend === 'down'
                            ? 'trending-down'
                            : 'minus'
                      }
                      size={18}
                      color={
                        stat.comparison.isGood === true
                          ? colors.success
                          : stat.comparison.isGood === false
                            ? colors.error
                            : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.comparisonLargeText,
                        stat.comparison.isGood === true && styles.comparisonTextGood,
                        stat.comparison.isGood === false && styles.comparisonTextBad,
                      ]}
                    >
                      {stat.comparison.value}
                    </Text>
                  </View>
                </View>
              )}

              {/* Close hint */}
              <Text style={styles.closeHint}>{t('activity.tapToClose')}</Text>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 340,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalIconContainer: {
    width: 56,
    height: 56,
    borderRadius: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  modalHeaderText: {
    flex: 1,
  },
  modalValue: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalTitle: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  contextBanner: {
    padding: spacing.sm,
    borderRadius: 10,
    marginBottom: spacing.md,
  },
  contextBannerText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    textAlign: 'center',
  },
  explanationBox: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  explanationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  explanationTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  explanationText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  detailsList: {
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: opacity.overlay.light,
  },
  detailLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  comparisonSection: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  comparisonLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  comparisonLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: opacity.overlay.light,
    paddingHorizontal: layout.borderRadius,
    paddingVertical: 6,
    borderRadius: layout.borderRadius,
  },
  comparisonGood: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  comparisonBad: {
    backgroundColor: 'rgba(244, 67, 54, 0.15)',
  },
  comparisonLargeText: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  comparisonTextGood: {
    color: colors.success,
  },
  comparisonTextBad: {
    color: colors.error,
  },
  closeHint: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    opacity: 0.6,
  },
});
