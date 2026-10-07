import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useMetricSystem, useTheme } from '@/shared/app';
import { formatDistance } from '@/shared/format/format';
import { Row, pressable, pressRipple } from '@/shared/ui';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity, ink } from '@/theme';
import type { MapSection } from '@/features/maps/hooks/useEngineMapActivities';

interface SectionChooserProps {
  sections: MapSection[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SectionChooser({ sections, onSelect, onClose }: SectionChooserProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay} testID="section-chooser">
        <Pressable
          style={pressable(styles.backdrop)}
          android_ripple={pressRipple}
          onPress={onClose}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        />
        <View style={[styles.sheet, isDark && styles.sheetDark]}>
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('trainingScreen.sections')}
          </Text>
          <ScrollView>
            {sections.map((section) => (
              <Row
                key={section.id}
                testID={`section-choice-${section.id}`}
                onPress={() => onSelect(section.id)}
                accessibilityLabel={`${section.name}, ${formatDistance(section.distanceMeters, isMetric)}`}
              >
                <View style={styles.details}>
                  <Text style={[styles.name, isDark && styles.titleDark]} numberOfLines={1}>
                    {section.name}
                  </Text>
                  <Text style={[styles.distance, isDark && styles.distanceDark]}>
                    {formatDistance(section.distanceMeters, isMetric)}
                  </Text>
                </View>
              </Row>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colorWithOpacity(ink.black, 0.4) },
  sheet: {
    maxHeight: '60%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: layout.borderRadius,
    borderTopRightRadius: layout.borderRadius,
    paddingVertical: spacing.md,
  },
  sheetDark: { backgroundColor: darkColors.surfaceCard },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  titleDark: { color: darkColors.textPrimary },
  details: { flex: 1 },
  name: { color: colors.textPrimary, fontSize: typography.body.fontSize },
  distance: { color: colors.textSecondary, fontSize: typography.label.fontSize },
  distanceDark: { color: darkColors.textSecondary },
});
