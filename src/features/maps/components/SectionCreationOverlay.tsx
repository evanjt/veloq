/**
 * The section creation tool on an activity map: two taps place the start and
 * the end, and the tool runs in the shared map tool bar.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  opacity,
  spacing,
  typography,
} from '@/theme';
import { formatDistance } from '@/shared/format/format';
import { useMetricSystem, useTheme } from '@/shared/app';
import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { mapToolTitle } from '@/features/maps/lib/mapToolTitle';
import { MapToolBar, type MapToolHintTone } from './MapToolBar';

export type CreationState =
  'idle' | 'selectingStart' | 'selectingEnd' | 'confirming' | 'complete' | 'creating' | 'error';

/** Error details for debugging */
export interface SectionCreationError {
  /** User-friendly error message */
  message: string;
  /** Technical error from Rust/system */
  technicalDetails?: string | undefined;
  /** Activity ID for debugging */
  activityId?: string;
  /** Start/end indices for debugging */
  indices?: { start: number; end: number };
}

interface SectionCreationOverlayProps {
  /** Current creation state */
  state: CreationState;
  /** Selected start point index */
  startIndex: number | null;
  /** Distance of selected section in meters */
  sectionDistance: number | null;
  /** Number of GPS points in the selected section */
  sectionPointCount: number | null;
  /** Error details when state is 'error' */
  error?: SectionCreationError | null | undefined;
  /** Called when user confirms the section */
  onConfirm: () => void;
  /** Called when user cancels creation */
  onCancel: () => void;
  /** Called to reset selection */
  onReset: () => void;
  /** Called to dismiss error and retry */
  onDismissError?: (() => void) | undefined;
}

/** Past this many points a section takes noticeably longer to process. */
const LARGE_SECTION_POINTS = 5000;

export function SectionCreationOverlay({
  state,
  startIndex,
  sectionDistance,
  sectionPointCount,
  error,
  onConfirm,
  onCancel,
  onReset,
  onDismissError,
}: SectionCreationOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const isComplete = state === 'complete';
  const isCreating = state === 'creating';
  const isError = state === 'error';
  const hasSelection = startIndex !== null;

  const largeSelection =
    isComplete && sectionPointCount !== null && sectionPointCount >= LARGE_SECTION_POINTS;

  const prompt = ((): { text: string; tone: MapToolHintTone } => {
    switch (state) {
      case 'selectingEnd':
        return { text: t('maps.tapSelectEnd' as never), tone: 'muted' };
      case 'complete':
        return largeSelection
          ? { text: t('routes.largeSectionPerformanceWarning'), tone: 'warning' }
          : { text: t('maps.sectionSelected' as never), tone: 'muted' };
      case 'creating':
        return { text: t('common.creating' as never), tone: 'muted' };
      case 'error':
        return {
          text: error?.message || t('routes.sectionCreationFailed' as never),
          tone: 'error',
        };
      default:
        return { text: t('maps.tapSelectStart' as never), tone: 'muted' };
    }
  })();

  // Each step's prompt is spoken as the step begins. A finished selection is
  // spoken with its length, so the line says what the length is of.
  const spoken =
    isComplete && sectionDistance !== null
      ? `${t('maps.sectionSelected' as never)}, ${formatDistance(sectionDistance, isMetric)}`
      : prompt.text;
  useAnnounceOnAppear(spoken);

  const placed = isComplete || isCreating || isError;
  const title = mapToolTitle(
    t('maps.newSection' as never),
    placed ? sectionDistance : null,
    isMetric
  );
  const mutedText = { color: palette.textSecondary };
  const detailsStyle = isDark
    ? { backgroundColor: colorWithOpacity(ink.white, opacity.tint1) }
    : null;

  return (
    <MapToolBar
      title={title}
      hint={prompt.text}
      hintTone={prompt.tone}
      hintAccessibilityLabel={spoken}
      onCancel={onCancel}
      onDone={isError && onDismissError ? onDismissError : onConfirm}
      doneLabel={isError && onDismissError ? t('common.retry') : undefined}
      doneDisabled={!isComplete && !(isError && onDismissError)}
      busy={isCreating}
      reset={hasSelection && !isError ? { onPress: onReset } : undefined}
      bottomInset={insets.bottom}
    >
      {isError && error ? (
        <View style={styles.details}>
          <Button
            testID="section-creation-technical-toggle"
            label={
              showTechnicalDetails
                ? t('common.hideDetails' as never)
                : t('common.showDetails' as never)
            }
            variant="ghost"
            size="sm"
            expanded={showTechnicalDetails}
            style={styles.technicalToggle}
            onPress={() => setShowTechnicalDetails(!showTechnicalDetails)}
          />

          {showTechnicalDetails ? (
            <View style={[styles.technicalDetails, detailsStyle]}>
              {error.technicalDetails ? (
                <View style={styles.detailRow}>
                  <Icon name="code-tags" size={iconSize.sm} color={palette.textSecondary} />
                  <Text style={[styles.technicalText, mutedText]} selectable>
                    {error.technicalDetails}
                  </Text>
                </View>
              ) : null}
              {error.activityId ? (
                <View style={styles.detailRow}>
                  <Icon name="identifier" size={iconSize.sm} color={palette.textSecondary} />
                  <Text style={[styles.technicalText, mutedText]} selectable>
                    {t('routes.errorDetailId', { id: error.activityId })}
                  </Text>
                </View>
              ) : null}
              {error.indices ? (
                <View style={styles.detailRow}>
                  <Icon
                    name="arrow-expand-horizontal"
                    size={iconSize.sm}
                    color={palette.textSecondary}
                  />
                  <Text style={[styles.technicalText, mutedText]}>
                    {t('routes.errorDetailRange', {
                      start: error.indices.start,
                      end: error.indices.end,
                    })}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.helpText, mutedText]}>
                {t('routes.shareDetailsWithDeveloper' as never)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </MapToolBar>
  );
}

const styles = StyleSheet.create({
  details: {
    gap: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  // The toggle sits at the start of the details it opens.
  technicalToggle: {
    alignSelf: 'flex-start',
  },
  technicalDetails: {
    backgroundColor: colorWithOpacity(ink.black, opacity.tint1),
    borderRadius: layout.borderRadiusXs,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  technicalText: {
    ...typography.caption,
    fontFamily: typography.code.fontFamily,
    fontSize: typography.label.fontSize,
    flex: 1,
  },
  helpText: {
    ...typography.caption,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
