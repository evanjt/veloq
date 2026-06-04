import React, { useCallback } from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { navigateTo } from '@/lib';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight, SupportingActivity } from '@/types';

interface MethodologySectionProps {
  insight: Insight;
}

export const MethodologySection = React.memo(function MethodologySection({
  insight,
}: MethodologySectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const methodology = insight.methodology;
  const supportingData = insight.supportingData;

  // Determine what content is available
  const formula = supportingData?.formula ?? methodology?.formula;
  const algorithmDescription = supportingData?.algorithmDescription;
  const activities = supportingData?.activities;
  const hasActivities = activities != null && activities.length > 0;
  const hasLegacyReference = methodology?.reference != null;
  const hasDescription = methodology?.description != null;

  const hasAnyContent =
    formula != null ||
    algorithmDescription != null ||
    hasActivities ||
    hasLegacyReference ||
    hasDescription;

  if (!hasAnyContent) return null;

  return (
    <View testID="methodology-section" style={styles.container}>
      <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>
        {t('insights.howCalculated', 'How was this calculated?')}
      </Text>

      <View style={styles.body}>
        {/* Algorithm description as plain text — the simple explanation */}
        {algorithmDescription ? (
          <Text style={[styles.algorithmText, isDark && styles.algorithmTextDark]}>
            {algorithmDescription}
          </Text>
        ) : hasDescription ? (
          <Text style={[styles.algorithmText, isDark && styles.algorithmTextDark]}>
            {methodology!.description}
          </Text>
        ) : null}

        {/* Formula display */}
        {formula ? <FormulaBlock formula={formula} isDark={isDark} /> : null}

        {/* Source activities */}
        {hasActivities ? <SourceActivitiesList activities={activities!} isDark={isDark} /> : null}

        {/* Legacy single reference */}
        {hasLegacyReference ? (
          <LegacyReference
            reference={methodology!.reference!}
            referenceUrl={methodology!.referenceUrl}
            isDark={isDark}
          />
        ) : null}
      </View>
    </View>
  );
});

/** Renders a formula in a monospace styled box */
const FormulaBlock = React.memo(function FormulaBlock({
  formula,
  isDark,
}: {
  formula: string;
  isDark: boolean;
}) {
  return (
    <View style={[styles.formulaContainer, isDark && styles.formulaContainerDark]}>
      <Text style={[styles.formulaText, isDark && styles.formulaTextDark]}>{formula}</Text>
    </View>
  );
});

/** Renders a tappable list of source activities */
const SourceActivitiesList = React.memo(function SourceActivitiesList({
  activities,
  isDark,
}: {
  activities: SupportingActivity[];
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const displayed = activities.slice(0, 5);

  const handlePress = useCallback((activityId: string) => {
    navigateTo(`/activity/${activityId}`);
  }, []);

  return (
    <View style={styles.activitiesContainer}>
      <Text style={[styles.activitiesSectionLabel, isDark && styles.activitiesSectionLabelDark]}>
        {t('insights.sourceActivities', 'Source activities')}
      </Text>
      {displayed.map((activity) => (
        <Pressable
          key={activity.activityId}
          style={[styles.activityRow, isDark && styles.activityRowDark]}
          onPress={() => handlePress(activity.activityId)}
        >
          <View style={styles.activityInfo}>
            <Text style={[styles.activityDate, isDark && styles.activityDateDark]}>
              {formatActivityDate(activity.date)}
            </Text>
            <Text
              style={[styles.activityName, isDark && styles.activityNameDark]}
              numberOfLines={1}
            >
              {activity.activityName}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={16}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      ))}
      {activities.length > 5 ? (
        <Text style={[styles.moreActivities, isDark && styles.moreActivitiesDark]}>
          +{activities.length - 5} more
        </Text>
      ) : null}
    </View>
  );
});

/** Renders a single legacy reference */
const LegacyReference = React.memo(function LegacyReference({
  reference,
  referenceUrl,
  isDark,
}: {
  reference: string;
  referenceUrl?: string;
  isDark: boolean;
}) {
  const handlePress = useCallback(() => {
    if (referenceUrl) {
      Linking.openURL(referenceUrl);
    }
  }, [referenceUrl]);

  if (referenceUrl) {
    return (
      <Pressable onPress={handlePress} style={styles.legacyReferenceContainer}>
        <Text
          style={[
            styles.referenceText,
            isDark && styles.referenceTextDark,
            styles.referenceTappable,
          ]}
        >
          {reference}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.legacyReferenceContainer}>
      <Text style={[styles.referenceText, isDark && styles.referenceTextDark]}>{reference}</Text>
    </View>
  );
});

/** Format an ISO date string to a short readable date */
function formatActivityDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  sectionTitleDark: {
    color: darkColors.textSecondary,
  },
  body: {
    gap: spacing.sm,
  },
  // Formula
  formulaContainer: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
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
  // Algorithm description
  algorithmText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  algorithmTextDark: {
    color: darkColors.textSecondary,
  },
  // Source activities
  activitiesContainer: {
    gap: spacing.xs,
  },
  activitiesSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  activitiesSectionLabelDark: {
    color: darkColors.textSecondary,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  activityRowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  activityInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activityDate: {
    fontSize: 12,
    color: colors.textSecondary,
    minWidth: 72,
  },
  activityDateDark: {
    color: darkColors.textSecondary,
  },
  activityName: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  activityNameDark: {
    color: darkColors.textPrimary,
  },
  moreActivities: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    paddingLeft: spacing.sm,
  },
  moreActivitiesDark: {
    color: darkColors.textSecondary,
  },
  referenceText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textSecondary,
    lineHeight: 18,
  },
  referenceTextDark: {
    color: darkColors.textSecondary,
  },
  referenceTappable: {
    color: '#009688',
    textDecorationLine: 'underline',
  },
  legacyReferenceContainer: {
    paddingTop: spacing.xs,
  },
});
