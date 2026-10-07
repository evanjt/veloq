/**
 * The section's ledger: stored versions with revert, and every change the
 * detector recorded, each with the activities that were around it.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { formatDuration, getIntlLocale } from '@/shared/format/format';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import { Button, Card } from '@/shared/ui';
import type {
  SectionGeometryVersion,
  SectionHistoryEvent,
} from '@/features/routes/hooks/useSectionLedger';
import {
  FIXED_LABEL_LEDGER_KINDS,
  ledgerDate,
  parseEventDetails,
  type EventDetails,
} from '@/features/routes/lib/sectionLedger';

export const MAX_CHIPS = 6;

interface SectionLink {
  id: string;
  name: string | null;
  available: boolean;
}

interface LinkedHistoryEvent extends SectionHistoryEvent {
  splitFrom?: SectionLink | null;
  splitInto?: SectionLink[];
}

export interface SectionHistoryPanelProps {
  isDark: boolean;
  history: LinkedHistoryEvent[];
  versions: SectionGeometryVersion[];
  pinnedVersion: number | null;
  shownVersion: number | null;
  onShowVersion: (version: number | null) => void;
  onRevert: (version: number) => void;
  onUnpin: () => void;
  /** Activity display names by id. Ids absent from it draw as themselves. */
  activityNames?: Record<string, string>;
  /** The line to show when the ledger could not be read, in place of the empty one. */
  failureKey?: string | null;
}

function SplitTarget({
  link,
  isDark,
  direction,
}: {
  link: SectionLink;
  isDark: boolean;
  direction: 'from' | 'into';
}) {
  const { t } = useTranslation();
  const name = link.name?.trim() || link.id;
  const testID = `section-history-split-${direction}-${link.id}`;
  if (!link.available) {
    return (
      <View testID={testID} style={[styles.chip, styles.splitTarget, isDark && styles.chipDark]}>
        <Text style={[styles.chipText, isDark && styles.textDark]}>
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
      onPress={() => router.push(`/section/${link.id}`)}
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
  const shown = ids.slice(0, MAX_CHIPS);
  const rest = ids.length - shown.length;
  return (
    <View style={styles.chips} testID={testID}>
      {shown.map((id) => (
        <TouchableOpacity
          key={id}
          testID={`${testID}-${id}`}
          style={[styles.chip, isDark && styles.chipDark]}
          onPress={() => router.push(`/activity/${id}`)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="map-marker-path"
            size={12}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.chipText, isDark && styles.textDark]} numberOfLines={1}>
            {chipLabel(id, names)}
          </Text>
        </TouchableOpacity>
      ))}
      {rest > 0 && <Text style={[styles.more, isDark && styles.textDark]}>+{rest}</Text>}
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
  activityNames,
  failureKey = null,
}: SectionHistoryPanelProps) {
  const { t } = useTranslation();
  const locale = getIntlLocale();
  const newest = useMemo(() => Math.max(0, ...versions.map((v) => v.version)), [versions]);

  // A record is held within one sport, so a line about one names it.
  const inSport = (sport: string | undefined, line: string): string =>
    sport ? `${t(`activityTypes.${sport}` as never, { defaultValue: sport })} · ${line}` : line;

  const kindLine = (e: LinkedHistoryEvent, d: EventDetails): string => {
    switch (e.kind) {
      case 'split':
        return t('sectionHistory.kind_split', { count: d.siblings });
      case 'reverted':
        return t('sectionHistory.kind_reverted', { version: d.version ?? e.geometryVersion ?? '' });
      case 'reference_anchored':
        return t(
          d.moved === false
            ? 'sectionHistory.kind_reference_anchored_in_place'
            : 'sectionHistory.kind_reference_anchored'
        );
      default:
        return FIXED_LABEL_LEDGER_KINDS.has(e.kind)
          ? t(`sectionHistory.kind_${e.kind}` as never)
          : e.kind;
    }
  };

  return (
    <Card variant="flat" testID="section-history-panel">
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="history"
          size={18}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />
        <Text style={[styles.title, isDark && styles.textDark]}>{t('sectionHistory.title')}</Text>
        {pinnedVersion != null && (
          <TouchableOpacity
            testID="section-history-unpin"
            style={[styles.pill, isDark && styles.pillDark]}
            onPress={onUnpin}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="pin-off" size={12} color={colors.primary} />
            <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
              {t('sectionHistory.unpin')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {versions.length > 1 && (
        <View style={styles.block}>
          <Text style={[styles.label, isDark && styles.textDark]}>
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
                <TouchableOpacity
                  testID={`section-version-${v.version}-show`}
                  style={[styles.pill, isDark && styles.pillDark]}
                  onPress={() => onShowVersion(isShown ? null : v.version)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                    {isShown ? t('sectionHistory.hideOnMap') : t('sectionHistory.showOnMap')}
                  </Text>
                </TouchableOpacity>
                {!isPinned && !isCurrent && (
                  <TouchableOpacity
                    testID={`section-version-${v.version}-revert`}
                    style={[styles.pill, isDark && styles.pillDark]}
                    onPress={() => onRevert(v.version)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="undo-variant" size={12} color={colors.primary} />
                    <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                      {t('sectionHistory.revert')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      {failureKey ? (
        <Text testID="section-history-failed" style={[styles.empty, isDark && styles.textDark]}>
          {t(failureKey as never)}
        </Text>
      ) : history.length === 0 ? (
        <Text style={[styles.empty, isDark && styles.textDark]}>{t('sectionHistory.empty')}</Text>
      ) : (
        history.map((e) => {
          const d = parseEventDetails(e.details);
          return (
            <View key={e.id} style={styles.event} testID={`section-history-event-${e.kind}`}>
              <Text style={[styles.date, isDark && styles.textDark]}>
                {ledgerDate(e.at).toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
              <Text style={[styles.kind, isDark && styles.textDark]}>{kindLine(e, d)}</Text>
              {e.kind === 'formed' && e.splitFrom && (
                <View style={styles.block}>
                  <Text style={[styles.label, isDark && styles.textDark]}>
                    {t('sectionHistory.splitFrom')}
                  </Text>
                  <SplitTarget link={e.splitFrom} isDark={isDark} direction="from" />
                </View>
              )}
              {e.kind === 'split' && e.splitInto && e.splitInto.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.label, isDark && styles.textDark]}>
                    {t('sectionHistory.splitInto')}
                  </Text>
                  <View style={styles.chips}>
                    {e.splitInto.map((link) => (
                      <SplitTarget key={link.id} link={link} isDark={isDark} direction="into" />
                    ))}
                  </View>
                </View>
              )}
              {e.kind === 'pr_rebased' && d.prFrom != null && d.prTo != null && (
                <Text style={[styles.meta, isDark && styles.textDark]}>
                  {inSport(
                    d.prSport,
                    t('sectionHistory.prMoved', {
                      from: formatDuration(d.prFrom),
                      to: formatDuration(d.prTo),
                    })
                  )}
                </Text>
              )}
              {e.kind !== 'pr_rebased' &&
                d.prs.map((record) => (
                  <Text key={record.sport ?? ''} style={[styles.meta, isDark && styles.textDark]}>
                    {inSport(
                      record.sport,
                      t('sectionHistory.prEra', { time: formatDuration(record.time) })
                    )}
                  </Text>
                ))}
              {d.around.length > 0 && (
                <>
                  <Text style={[styles.label, isDark && styles.textDark]}>
                    {t('sectionHistory.around')}
                  </Text>
                  <Chips
                    ids={d.around}
                    isDark={isDark}
                    testID={`section-history-around-${e.id}`}
                    names={activityNames}
                  />
                </>
              )}
              {d.forkAround.length > 0 && (
                <>
                  <Text style={[styles.label, isDark && styles.textDark]}>
                    {t('sectionHistory.forkAround')}
                  </Text>
                  <Chips
                    ids={d.forkAround}
                    isDark={isDark}
                    testID={`section-history-fork-${e.id}`}
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flex: 1,
  },
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusLg,
    backgroundColor: colors.background,
  },
  pillDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  pillText: {
    ...typography.caption,
    color: colors.linkTeal,
  },
  event: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
    borderRadius: layout.borderRadiusLg,
    backgroundColor: colors.background,
    maxWidth: 160,
  },
  chipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  splitTarget: {
    minHeight: layout.minTapTarget,
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
  empty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
});
