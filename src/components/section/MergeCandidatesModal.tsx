/**
 * Picker modal for selecting which candidate section to merge.
 *
 * Shown when a section has 2+ merge candidates. Single-candidate sections
 * bypass this and go straight to MergeConfirmDialog.
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import type { MergeCandidate } from 'veloqrs';
import { colors, darkColors, spacing, typography, layout, shadows } from '@/theme';

interface MergeCandidatesModalProps {
  visible: boolean;
  candidates: MergeCandidate[];
  onSelect: (candidate: MergeCandidate) => void;
  onCancel: () => void;
}

export const MergeCandidatesModal = memo(function MergeCandidatesModal({
  visible,
  candidates,
  onSelect,
  onCancel,
}: MergeCandidatesModalProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const bg = isDark ? darkColors.surface : colors.surface;
  const text = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;

  const renderItem = ({ item }: { item: MergeCandidate }) => (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: border }]}
      onPress={() => onSelect(item)}
      activeOpacity={0.6}
    >
      <MaterialCommunityIcons
        name={getActivityIcon(item.sportType)}
        size={22}
        color={textSecondary}
      />
      <View style={styles.rowContent}>
        <Text style={[styles.rowName, { color: text }]} numberOfLines={1}>
          {item.name ?? item.sectionId}
        </Text>
        <Text style={[styles.rowMeta, { color: textSecondary }]}>
          {t('sections.visitsCount', { count: item.visitCount })}
          {' · '}
          {Math.round(item.distanceMeters)}m{' · '}
          {Math.round(item.overlapPct * 100)}% {t('sections.overlapLabel')}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: bg }]}>
          <Text style={[styles.title, { color: text }]}>{t('sections.mergeCandidatesTitle')}</Text>
          <Text style={[styles.subtitle, { color: textSecondary }]}>
            {t('sections.mergeCandidatesSubtitle', { count: candidates.length })}
          </Text>

          <FlatList
            data={candidates}
            keyExtractor={(item) => item.sectionId}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={[styles.cancelText, { color: textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '80%',
    borderRadius: layout.borderRadius,
    padding: spacing.lg,
    ...shadows.modal,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodySmall.fontSize,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
  },
  rowContent: {
    flex: 1,
  },
  rowName: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: typography.caption.fontSize,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
  },
});
