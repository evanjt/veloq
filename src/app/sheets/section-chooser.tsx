import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useMetricSystem, useTheme } from '@/shared/app';
import { goBack } from '@/shared/app/navigation';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatDistance } from '@/shared/format/format';
import { Row, SheetHeader } from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';
import { NameText } from '@/shared/ui/NameText';

/**
 * The chooser for a map tap where several sections overlap, a sheet route opened with
 * `openSheet` and answered with the chosen section's id.
 */

export interface SectionChooserInput {
  sections: { id: string; name: string; distanceMeters: number }[];
}

function SectionChooserSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<SectionChooserInput, string>();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.sheet} testID="section-chooser">
      <SheetHeader
        title={t('maps.chooseSection')}
        onCancel={() => goBack()}
        cancelTestID="section-chooser-cancel"
      />
      <ScrollView>
        {(input?.sections ?? []).map((section) => {
          const distance = formatDistance(section.distanceMeters, isMetric);
          return (
            <Row
              key={section.id}
              testID={`section-choice-${section.id}`}
              behaviour="act"
              onPress={() => resolve(section.id)}
              accessibilityLabel={`${section.name}, ${distance}`}
            >
              <View style={styles.details}>
                <NameText style={[styles.name, { color: textPrimary }]}>{section.name}</NameText>
                <Text style={[styles.distance, { color: textSecondary }]}>{distance}</Text>
              </View>
            </Row>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(SectionChooserSheetContent, 'Section chooser');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: spacing.md,
  },
  details: { flex: 1 },
  name: { ...typography.body },
  distance: { fontSize: typography.label.fontSize },
});
