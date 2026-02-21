import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';
import type { Insight } from '@/types';

interface InsightExplainerModalProps {
  insight: Insight | null;
  visible: boolean;
  onClose: () => void;
}

export const InsightExplainerModal = React.memo(function InsightExplainerModal({
  insight,
  visible,
  onClose,
}: InsightExplainerModalProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  if (!insight || !visible) return null;

  const handleViewDetails = () => {
    if (insight.navigationTarget) {
      onClose();
      router.push(insight.navigationTarget as never);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, isDark && styles.cardDark]} onPress={() => {}}>
          {/* Colored banner */}
          <View style={[styles.banner, { backgroundColor: insight.iconColor }]}>
            <MaterialCommunityIcons name={insight.icon as never} size={40} color="#FFFFFF" />
          </View>

          {/* Close button overlaid on banner */}
          <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>

          {/* Title */}
          <Text style={[styles.title, isDark && styles.titleDark]}>{insight.title}</Text>

          {/* Subtitle */}
          {insight.subtitle ? (
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>{insight.subtitle}</Text>
          ) : null}

          {/* Body */}
          {insight.body ? (
            <Text style={[styles.body, isDark && styles.bodyDark]}>{insight.body}</Text>
          ) : null}

          {/* View details button */}
          {insight.navigationTarget ? (
            <Pressable style={styles.detailsButton} onPress={handleViewDetails}>
              <Text style={styles.detailsButtonText}>
                {t('insights.viewDetails')} {'\u2192'}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '80%',
    maxWidth: 320,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 20,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  banner: {
    width: '100%',
    height: 90,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
    zIndex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: spacing.md,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: spacing.xs,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
    marginTop: spacing.sm,
  },
  bodyDark: {
    color: darkColors.textSecondary,
  },
  detailsButton: {
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  detailsButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FC4C02',
    textAlign: 'center',
  },
});
