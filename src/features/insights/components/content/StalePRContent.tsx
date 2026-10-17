import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunc } from '../../types';
import { sectionRowKey, sectionWithSport } from '../../lib/cardSport';
import type { TFunction } from 'i18next';
import { useTheme } from '@/shared/app';
import {
  getActivityIcon,
  isCyclingActivity,
  isPaceSport,
  isSwimmingActivity,
} from '@/shared/activity/activityUtils';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { tapTo } from '@/shared/app/navigation';
import { formatDuration } from '@/shared/format/format';
import { SectionInsightMap } from './SectionInsightMap';
import { InsightHistoryChart } from '../InsightHistoryChart';
import { colors, darkColors, iconSize, insightToneColor, spacing, typography } from '@/theme';
import type { ActivityType, Insight, SupportingSection } from '@/types';
import { SheetContext } from './SheetContext';
import { composeAccessibilityLabel, ErrorState, Row } from '@/shared/ui';
import { NameText } from '@/shared/ui/NameText';

interface StalePRContentProps {
  insight: Insight;
}

/** The one sport every section shares, as the engine names it, or null. */
function getSingleSportType(sections: SupportingSection[]): string | null {
  const uniqueSports = Array.from(
    new Set(
      sections
        .map((section) => section.sportType)
        .filter(
          (sportType): sportType is string => typeof sportType === 'string' && sportType.length > 0
        )
    )
  );

  return uniqueSports.length === 1 ? uniqueSports[0] : null;
}

/**
 * The heading names what the card compared, read from the units the generator
 * set rather than from its translated labels: watts are eFTP, a pace per
 * hundred metres is CSS, a pace per kilometre is critical speed. A group card
 * carries no rows, and the engine compares a ride's eFTP and a run's or a
 * swim's critical speed, so there the sport its sections share says which.
 */
function getContextCopy(
  sections: SupportingSection[],
  dataPoints: { unit?: string | undefined }[],
  t: TFunction
): {
  heading: string;
  body: string;
  meta: string;
} {
  const units = new Set(
    dataPoints
      .map((dataPoint) => dataPoint.unit)
      .filter((unit): unit is string => typeof unit === 'string' && unit.length > 0)
  );
  const sportType = getSingleSportType(sections);
  const sport = sportType ? t(`activityTypes.${sportType}`, { defaultValue: sportType }) : null;
  const isGrouped = sections.length > 1;
  // The engine's own sport name, which is what the sport predicates take.
  const activity = units.size === 0 ? (sportType as ActivityType | null) : null;

  const heading =
    units.has('W') || (activity != null && isCyclingActivity(activity))
      ? t('insights.stalePr.sheetHeadingPower')
      : units.has('/100m') || (activity != null && isSwimmingActivity(activity))
        ? t('insights.stalePr.sheetHeadingSwim')
        : units.has('/km') || (activity != null && isPaceSport(activity))
          ? t('insights.stalePr.sheetHeadingRun')
          : t('insights.stalePr.sheetHeadingFitness');

  const body = isGrouped
    ? sport
      ? t('insights.stalePr.sheetBodyManySport', { sport })
      : t('insights.stalePr.sheetBodyMany')
    : sport
      ? t('insights.stalePr.sheetBodyOneSport', { sport })
      : t('insights.stalePr.sheetBodyOne');

  return {
    heading,
    body,
    meta: isGrouped ? t('insights.stalePr.sheetMetaMany') : t('insights.stalePr.sheetMetaOne'),
  };
}

/** Map preview for the first section */
const TopSectionMap = React.memo(function TopSectionMap({ sectionId }: { sectionId: string }) {
  const { isDark } = useTheme();
  const { section, error, retry } = useSectionDetail(sectionId);
  if (error !== undefined) {
    return (
      <ErrorState variant="inline" error={error} onRetry={retry} testID="section-read-failure" />
    );
  }
  if (!section?.polyline || section.polyline.length < 2) return null;
  return (
    <SectionInsightMap
      polyline={section.polyline}
      lineColor={insightToneColor('opportunity', isDark)}
    />
  );
});

/**
 * Detail content for stale PR / opportunity insights.
 * Shows section map + the card's efforts + context copy + tappable section list.
 * Its numbers sit under the sheet's "How was this calculated?".
 */
export const StalePRContent = React.memo(function StalePRContent({ insight }: StalePRContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const dataPoints = insight.supportingData?.dataPoints ?? [];
  const sections = insight.supportingData?.sections ?? [];
  const topSectionId = sections[0]?.sectionId ?? null;
  const contextCopy = getContextCopy(sections, dataPoints, t);

  const handleSectionPress = useCallback((id: string) => {
    tapTo(`/section/${id}`);
  }, []);

  return (
    <View style={styles.container}>
      {topSectionId ? <TopSectionMap sectionId={topSectionId} /> : null}

      <InsightHistoryChart
        history={insight.supportingData?.history}
        color={insightToneColor('opportunity', isDark)}
      />

      <SheetContext heading={contextCopy.heading} body={contextCopy.body} meta={contextCopy.meta} />

      {sections.length > 0 ? (
        <View>
          {sections.map((s: SupportingSection) => {
            const name = sectionWithSport(s.sectionName, s.sportType, t as unknown as TFunc);
            const bestTime = s.bestTime != null ? formatDuration(s.bestTime) : null;
            return (
              <Row
                key={sectionRowKey(s)}
                behaviour="navigate"
                accessibilityLabel={composeAccessibilityLabel(name, bestTime)}
                onPress={() => handleSectionPress(s.sectionId)}
              >
                <View style={styles.sectionContent}>
                  <View style={styles.sectionNameRow}>
                    {s.sportType ? (
                      <MaterialCommunityIcons
                        name={getActivityIcon(s.sportType)}
                        size={iconSize.sm}
                        color={isDark ? darkColors.textSecondary : colors.textSecondary}
                        style={styles.sportIcon}
                      />
                    ) : null}
                    <NameText style={[styles.sectionName, isDark && styles.sectionNameDark]}>
                      {name}
                    </NameText>
                  </View>
                  {bestTime != null ? (
                    <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>{bestTime}</Text>
                  ) : null}
                </View>
              </Row>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionNameRow: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginRight: spacing.sm,
  },
  sportIcon: {
    marginRight: spacing.xs,
  },
  sectionName: {
    ...typography.bodySmallBold,
    flex: 1,
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  bestTime: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
});
