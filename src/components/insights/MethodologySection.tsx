import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { CollapsibleSection } from '@/components/ui';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { InsightMethodology, InsightReference } from '@/types';

interface MethodologySectionProps {
  methodology: InsightMethodology;
}

export const MethodologySection = React.memo(function MethodologySection({
  methodology,
}: MethodologySectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const handleReferencePress = useCallback(() => {
    if (methodology.referenceUrl) {
      Linking.openURL(methodology.referenceUrl);
    }
  }, [methodology.referenceUrl]);

  const handleRefPress = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);

  // New references array takes precedence over legacy reference/referenceUrl
  const hasReferences = methodology.references && methodology.references.length > 0;

  const legacyReferenceContent =
    !hasReferences && methodology.reference ? (
      methodology.referenceUrl ? (
        <TouchableOpacity onPress={handleReferencePress} activeOpacity={0.7}>
          <Text
            style={[styles.reference, isDark && styles.referenceDark, styles.referenceTappable]}
          >
            {methodology.reference}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.reference, isDark && styles.referenceDark]}>
          {methodology.reference}
        </Text>
      )
    ) : null;

  const referencesContent = hasReferences ? (
    <View style={styles.referencesList}>
      {methodology.references!.map((ref: InsightReference, i: number) => (
        <View key={i} style={styles.referenceItem}>
          <Text style={[styles.referenceNumber, isDark && styles.referenceNumberDark]}>
            {i + 1}.
          </Text>
          {ref.url ? (
            <TouchableOpacity
              style={styles.referenceTextContainer}
              onPress={() => handleRefPress(ref.url!)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.referenceText,
                  isDark && styles.referenceDark,
                  styles.referenceTappable,
                ]}
              >
                {ref.citation}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text
              style={[
                styles.referenceText,
                isDark && styles.referenceDark,
                styles.referenceTextContainer,
              ]}
            >
              {ref.citation}
            </Text>
          )}
        </View>
      ))}
    </View>
  ) : null;

  const hasCollapsibleContent = methodology.formula || hasReferences || methodology.reference;

  return (
    <View style={styles.container}>
      <Text style={[styles.description, isDark && styles.descriptionDark]}>
        {methodology.description}
      </Text>

      {hasCollapsibleContent ? (
        <CollapsibleSection
          title={t('insights.showMethodology', 'Show methodology')}
          expanded={expanded}
          onToggle={setExpanded}
          icon="flask-outline"
          estimatedHeight={hasReferences ? 60 + methodology.references!.length * 60 : 120}
        >
          <View style={styles.collapsibleContent}>
            {methodology.formula ? (
              <View style={[styles.formulaContainer, isDark && styles.formulaContainerDark]}>
                <Text style={[styles.formulaText, isDark && styles.formulaTextDark]}>
                  {methodology.formula}
                </Text>
              </View>
            ) : null}
            {referencesContent}
            {legacyReferenceContent}
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
  referenceTappable: {
    color: '#009688',
    textDecorationLine: 'underline',
  },
  referenceDark: {
    color: darkColors.textSecondary,
  },
  referencesList: {
    gap: spacing.sm,
  },
  referenceItem: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  referenceNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 18,
    minWidth: 16,
  },
  referenceNumberDark: {
    color: darkColors.textSecondary,
  },
  referenceTextContainer: {
    flex: 1,
  },
  referenceText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
