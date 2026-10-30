/**
 * The section's ledger: stored versions with revert, and every change the
 * detector recorded, each with its headline, one reason and the rides that followed it.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { FfiSectionLink } from 'veloqrs';
import { formatDuration, formatFullDate } from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app';
import { colors, controlHeight, darkColors, layout, spacing, typography, stroke } from '@/theme';
import { Button, Card, EmptyState } from '@/shared/ui';
import type {
  SectionGeometryVersion,
  SectionHistoryEvent,
} from '@/features/routes/hooks/useSectionLedger';
import { ledgerDate, NO_EVENT_DETAILS } from '@/features/routes/lib/sectionLedger';
import { changeCopy } from '@/features/routes/lib/sectionChangeCopy';
import { useOpenDetail } from '@/shared/app/MapSheetCards';

export const MAX_CHIPS = 3;

export interface SectionHistoryPanelProps {
  isDark: boolean;
  history: SectionHistoryEvent[];
  versions: SectionGeometryVersion[];
  pinnedVersion: number | null;
  shownVersion: number | null;
  onShowVersion: (version: number | null) => void;
  onRevert: (version: number) => void;
  onUnpin: () => void;
  /** A revert is running: revert and unpin are disabled until it ends. */
  isReverting?: boolean;
  /** Activity display names by id. Ids absent from it draw as themselves. */
  activityNames?: Record<string, string>;
}

function SplitTarget({
  link,
  isDark,
  direction,
}: {
  link: FfiSectionLink;
  isDark: boolean;
  direction: 'from' | 'into';
}) {
  const { t } = useTranslation();
  const openDetail = useOpenDetail();
  const name = link.name?.trim() || link.id;
  const testID = `section-history-split-${direction}-${link.id}`;
  if (!link.available) {
    return (
      <View testID={testID} style={[styles.chip, styles.splitTarget, isDark && styles.chipDark]}>
        <Text style={[styles.chipText, isDark && styles.textSecondaryDark]}>
          {link.name
            ? `${link.name} · ${t('sectionHistory.unavailable')}`
            : t('sectionHistory.unavailable')}
        </Text>
      </View>
    );
  }
  return (
    <Button
      testID={testID}
      label={name}
      variant="ghost"
      size="sm"
      style={[styles.chip, styles.splitTarget, isDark && styles.chipDark]}
      onPress={() => openDetail({ kind: 'section', id: link.id })}
    />
  );
}

/**
 * What a chip says: the activity's name, or the id when there is none.
 *
 * A blank name is no name. It would draw an empty chip, which is worse than
 * the id it replaced.
 */
export function chipLabel(id: string, names?: Record<string, string>): string {
  const name = names?.[id]?.trim();
  return name ? name : id;
}

function Chips({
  ids,
  isDark,
  testID,
  names,
}: {
  ids: string[];
  isDark: boolean;
  testID: string;
  names?: Record<string, string> | undefined;
}) {
  const openDetail = useOpenDetail();
  const shown = ids.slice(0, MAX_CHIPS);
  const rest = ids.length - shown.length;
  return (
    <View style={styles.chips} testID={testID}>
      {shown.map((id) => (
        <Button
          key={id}
          testID={`${testID}-${id}`}
          label={chipLabel(id, names)}
          variant="secondary"
          size="sm"
          icon="map-marker-path"
          style={styles.activityChip}
          onPress={() => openDetail({ kind: 'activity', id })}
        />
      ))}
      {rest > 0 && <Text style={[styles.more, isDark && styles.textSecondaryDark]}>+{rest}</Text>}
    </View>
  );
}

export function SectionHistoryPanel({
  isDark,
  history,
  versions,
  pinnedVersion,
  shownVersion,
  onShowVersion,
  onRevert,
  onUnpin,
  isReverting = false,
  activityNames,
}: SectionHistoryPanelProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const newest = useMemo(() => Math.max(0, ...versions.map((v) => v.version)), [versions]);

  // A record is held within one sport and one direction, so a line about one
  // names both. A row written before either was held carries neither.
  const inSport = (
    sport: string | undefined,
    direction: string | undefined,
    line: string
  ): string => {
    const parts: string[] = [];
    if (sport) parts.push(t(`activityTypes.${sport}` as never, { defaultValue: sport }));
    if (direction) parts.push(t(direction === 'reverse' ? 'sections.reverse' : 'sections.forward'));
    return [...parts, line].join(' · ');
  };

  return (
    <Card
      variant="flat"
      testID="section-history-panel"
      title={t('sectionHistory.title')}
      titleAccessory={
        pinnedVersion != null && (
          <Button
            testID="section-history-unpin"
            label={t('sectionHistory.unpin')}
            variant="ghost"
            size="sm"
            icon="pin-off"
            disabled={isReverting}
            onPress={onUnpin}
          />
        )
      }
    >
      {versions.length > 1 && (
        <View style={styles.block}>
          <Text style={[styles.label, isDark && styles.textSecondaryDark]}>
            {t('sectionHistory.versions')}
          </Text>
          {versions.map((v) => {
            const isCurrent = v.version === newest && pinnedVersion == null;
            const isPinned = v.version === pinnedVersion;
            const isShown = v.version === shownVersion;
            return (
              <View
                key={v.version}
                style={styles.versionRow}
                testID={`section-version-${v.version}`}
              >
                <Text style={[styles.versionText, isDark && styles.textDark]}>
                  {t('sectionHistory.version', { version: v.version })}
                  {isCurrent ? ` · ${t('sectionHistory.current')}` : ''}
                  {isPinned ? ` · ${t('sections.pinned')}` : ''}
                </Text>
                <Button
                  testID={`section-version-${v.version}-show`}
                  label={isShown ? t('sectionHistory.hideOnMap') : t('sectionHistory.showOnMap')}
                  accessibilityLabel={`${t('sectionHistory.version', { version: v.version })}, ${isShown ? t('sectionHistory.hideOnMap') : t('sectionHistory.showOnMap')}`}
                  variant="ghost"
                  size="sm"
                  onPress={() => onShowVersion(isShown ? null : v.version)}
                />
                {!isPinned && !isCurrent && (
                  <Button
                    testID={`section-version-${v.version}-revert`}
                    label={t('sectionHistory.revert')}
                    accessibilityLabel={t('sectionHistory.revertVersion', {
                      version: v.version,
                    })}
                    variant="ghost"
                    size="sm"
                    icon="undo-variant"
                    disabled={isReverting}
                    onPress={() => onRevert(v.version)}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}

      {history.length === 0 ? (
        <EmptyState variant="inline" title={t('sectionHistory.empty')} />
      ) : (
        history.map((e) => {
          const d = e.details ?? NO_EVENT_DETAILS;
          const copy = changeCopy(
            t,
            {
              kind: e.kind,
              summary: d.summary,
              siblingCount: d.siblings.length,
              version: d.version ?? e.geometryVersion ?? undefined,
              anchoredInPlace: d.moved === false,
              rideCount: d.around.length,
            },
            isMetric
          );
          const headline = copy.headline ?? e.kind;
          const isMuted = e.kind === 'baseline' || e.kind === 'algorithm_changed';
          const folded = e.kind === 'pr_rebased' && d.summary?.foldedInto != null;
          const records = d.summary?.records ?? [];
          return (
            <View
              key={e.id}
              style={[styles.event, isDark && styles.eventDark]}
              testID={`section-history-event-${e.kind}`}
            >
              <Text style={[styles.date, isDark && styles.textSecondaryDark]}>
                {formatFullDate(ledgerDate(e.at))}
              </Text>
              <Text
                style={
                  isMuted
                    ? [styles.meta, isDark && styles.textSecondaryDark]
                    : [styles.kind, isDark && styles.textDark]
                }
              >
                {headline}
              </Text>
              {copy.reason != null && (
                <Text
                  testID={`section-history-reason-${e.id}`}
                  style={[styles.meta, isDark && styles.textSecondaryDark]}
                >
                  {copy.reason}
                </Text>
              )}
              {e.kind === 'formed' && d.splitFrom ? (
                <View style={styles.block}>
                  <Text style={[styles.label, isDark && styles.textSecondaryDark]}>
                    {t('sectionHistory.splitFrom')}
                  </Text>
                  <SplitTarget link={d.splitFrom} isDark={isDark} direction="from" />
                </View>
              ) : null}
              {e.kind === 'split' && d.splitInto.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.label, isDark && styles.textSecondaryDark]}>
                    {t('sectionHistory.splitInto')}
                  </Text>
                  <View style={styles.chips}>
                    {d.splitInto.map((link) => (
                      <SplitTarget key={link.id} link={link} isDark={isDark} direction="into" />
                    ))}
                  </View>
                </View>
              )}
              {e.kind === 'pr_rebased' && !folded && d.prFrom != null && d.prTo != null && (
                <Text style={[styles.meta, isDark && styles.textSecondaryDark]}>
                  {inSport(
                    d.prSport,
                    d.prDirection,
                    t('sectionHistory.prMoved', {
                      from: formatDuration(d.prFrom),
                      to: formatDuration(d.prTo),
                    })
                  )}
                </Text>
              )}
              {records.map((record) => (
                <Text
                  key={`${record.sport ?? ''}-${record.direction ?? ''}`}
                  style={[styles.meta, isDark && styles.textSecondaryDark]}
                >
                  {inSport(
                    record.sport ?? undefined,
                    record.direction ?? undefined,
                    t('sectionHistory.prMoved', {
                      from: formatDuration(record.from ?? 0),
                      to: formatDuration(record.to ?? 0),
                    })
                  )}
                </Text>
              ))}
              {d.around.length > 0 && (
                <>
                  <Text style={[styles.label, isDark && styles.textSecondaryDark]}>
                    {t('sectionHistory.ridesAfter', { count: d.around.length })}
                  </Text>
                  <Chips
                    ids={d.around}
                    isDark={isDark}
                    testID={`section-history-around-${e.id}`}
                    names={activityNames}
                  />
                </>
              )}
            </View>
          );
        })
      )}
    </Card>
  );
}

// A caption line inside the padding of a split target chip.
const PILL_HEIGHT = typography.caption.lineHeight + 2 * spacing.xs;

const styles = StyleSheet.create({
  block: {
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  versionText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    flex: 1,
  },
  event: {
    paddingVertical: spacing.sm,
    borderTopWidth: stroke.hairline,
    borderTopColor: colors.border,
  },
  eventDark: {
    borderTopColor: darkColors.border,
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  kind: {
    ...typography.body,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: PILL_HEIGHT,
    borderRadius: layout.borderRadiusLg,
    backgroundColor: colors.surfacePage,
    maxWidth: 160,
  },
  activityChip: {
    maxWidth: 160,
  },
  chipDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  splitTarget: {
    minHeight: controlHeight.buttonSm,
    maxWidth: '100%',
    justifyContent: 'center',
  },
  chipText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  more: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
  textSecondaryDark: {
    color: darkColors.textSecondary,
  },
});
