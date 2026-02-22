import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { CollapsibleSection } from '@/components/ui';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { InsightMethodology } from '@/types';

interface MethodologySectionProps {
  methodology: InsightMethodology;
}

export const MethodologySection = React.memo(function MethodologySection({
  methodology,
}: MethodologySectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={[styles.description, isDark && styles.descriptionDark]}>
        {methodology.description}
      </Text>

      {methodology.formula || methodology.reference ? (
        <CollapsibleSection
          title={t('insights.showMethodology', 'Show methodology')}
          expanded={expanded}
          onToggle={setExpanded}
          icon="flask-outline"
          estimatedHeight={120}
        >
          <View style={styles.collapsibleContent}>
            {methodology.formula ? (
              <View style={[styles.formulaContainer, isDark && styles.formulaContainerDark]}>
                <Text style={[styles.formulaText, isDark && styles.formulaTextDark]}>
                  {methodology.formula}
                </Text>
              </View>
            ) : null}
            {methodology.reference ? (
              <Text style={[styles.reference, isDark && styles.referenceDark]}>
                {methodology.reference}
              </Text>
            ) : null}
          </View>
        </CollapsibleSection>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  collapsibleContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  formulaContainer: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  formulaContainerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  formulaText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  formulaTextDark: {
    color: darkColors.textPrimary,
  },
  reference: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textSecondary,
    lineHeight: 18,
  },
  referenceDark: {
    color: darkColors.textSecondary,
  },
});
