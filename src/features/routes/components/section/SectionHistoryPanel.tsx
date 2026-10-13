/**
 * The section's ledger: stored versions with revert, and every change the
 * detector recorded, each with the activities that were around it.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { FfiSectionEventDetails, FfiSectionLink } from 'veloqrs';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { formatDuration, formatFullDate } from '@/shared/format/format';
import {
  colors,
  controlHeight,
  darkColors,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { Button, Card } from '@/shared/ui';
import type {
  SectionGeometryVersion,
  SectionHistoryEvent,
} from '@/features/routes/hooks/useSectionLedger';
import {
  FIXED_LABEL_LEDGER_KINDS,
  ledgerDate,
  NO_EVENT_DETAILS,
} from '@/features/routes/lib/sectionLedger';
import { tapTo } from '@/shared/app/navigation';

export const MAX_CHIPS = 6;

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
      onPress={() => tapTo(`/section/${link.id}`)}
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
        <Pressable
          key={id}
          testID={`${testID}-${id}`}
          style={pressable([styles.chip, isDark && styles.chipDark])}
          hitSlop={pillSlop}
          accessibilityRole="button"
          accessibilityLabel={chipLabel(id, names)}
          onPress={() => tapTo(`/activity/${id}`)}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons
            name="map-marker-path"
            size={12}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.chipText, isDark && styles.textDark]} numberOfLines={1}>
            {chipLabel(id, names)}
          </Text>
        </Pressable>
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
  isReverting = false,
  activityNames,
}: SectionHistoryPanelProps) {
  const { t } = useTranslation();
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

  const kindLine = (e: SectionHistoryEvent, d: FfiSectionEventDetails): string => {
    switch (e.kind) {
      case 'split':
        return t('sectionHistory.kind_split', { count: d.siblings.length });
      case 'reverted':
        return t('sectionHistory.kind_reverted', {
          version: d.version ?? e.geometryVersion ?? '',
        });
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
        <Text accessibilityRole="header" style={[styles.title, isDark && styles.textDark]}>
          {t('sectionHistory.title')}
        </Text>
        {pinnedVersion != null && (
          <Pressable
            testID="section-history-unpin"
            style={pressable([styles.pill, isDark && styles.pillDark])}
            hitSlop={pillSlop}
            accessibilityRole="button"
            accessibilityLabel={t('sectionHistory.unpin')}
            accessibilityState={{ disabled: isReverting }}
            disabled={isReverting}
            onPress={onUnpin}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="pin-off" size={12} color={colors.primary} />
            <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
              {t('sectionHistory.unpin')}
            </Text>
          </Pressable>
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
                <Pressable
                  testID={`section-version-${v.version}-show`}
                  style={pressable([styles.pill, isDark && styles.pillDark])}
                  hitSlop={pillSlop}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('sectionHistory.version', { version: v.version })}, ${isShown ? t('sectionHistory.hideOnMap') : t('sectionHistory.showOnMap')}`}
                  accessibilityState={{ selected: isShown }}
                  onPress={() => onShowVersion(isShown ? null : v.version)}
                  android_ripple={pressRipple}
                >
                  <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                    {isShown ? t('sectionHistory.hideOnMap') : t('sectionHistory.showOnMap')}
                  </Text>
                </Pressable>
                {!isPinned && !isCurrent && (
                  <Pressable
                    testID={`section-version-${v.version}-revert`}
                    style={pressable([styles.pill, isDark && styles.pillDark])}
                    hitSlop={pillSlop}
                    accessibilityRole="button"
                    accessibilityLabel={t('sectionHistory.revertVersion', {
                      version: v.version,
                    })}
                    accessibilityState={{ disabled: isReverting }}
                    disabled={isReverting}
                    onPress={() => onRevert(v.version)}
                    android_ripple={pressRipple}
                  >
                    <MaterialCommunityIcons name="undo-variant" size={12} color={colors.primary} />
                    <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                      {t('sectionHistory.revert')}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      {history.length === 0 ? (
        <Text style={[styles.empty, isDark && styles.textDark]}>{t('sectionHistory.empty')}</Text>
      ) : (
        history.map((e) => {
          const d = e.details ?? NO_EVENT_DETAILS;
          return (
            <View
              key={e.id}
              style={[styles.event, isDark && styles.eventDark]}
              testID={`section-history-event-${e.kind}`}
            >
              <Text style={[styles.date, isDark && styles.textDark]}>
                {formatFullDate(ledgerDate(e.at))}
              </Text>
              <Text style={[styles.kind, isDark && styles.textDark]}>{kindLine(e, d)}</Text>
              {e.kind === 'formed' && d.splitFrom && (
                <View style={styles.block}>
                  <Text style={[styles.label, isDark && styles.textDark]}>
                    {t('sectionHistory.splitFrom')}
                  </Text>
                  <SplitTarget link={d.splitFrom} isDark={isDark} direction="from" />
                </View>
              )}
              {e.kind === 'split' && d.splitInto.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.label, isDark && styles.textDark]}>
                    {t('sectionHistory.splitInto')}
                  </Text>
                  <View style={styles.chips}>
                    {d.splitInto.map((link) => (
                      <SplitTarget key={link.id} link={link} isDark={isDark} direction="into" />
                    ))}
                  </View>
                </View>
              )}
              {e.kind === 'pr_rebased' && d.prFrom != null && d.prTo != null && (
                <Text style={[styles.meta, isDark && styles.textDark]}>
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
              {e.kind !== 'pr_rebased' &&
                d.prs.map((record) => (
                  <Text
                    key={`${record.sport ?? ''}-${record.direction ?? ''}`}
                    style={[styles.meta, isDark && styles.textDark]}
                  >
                    {inSport(
                      record.sport,
                      record.direction,
                      t('sectionHistory.prEra', {
                        time: formatDuration(record.time),
                      })
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

// A caption line inside the padding of the activity chips and the version pills.
const PILL_HEIGHT = typography.caption.lineHeight + 2 * spacing.xs;
const pillSlop = slopToMinTapTarget(PILL_HEIGHT);

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
    minHeight: PILL_HEIGHT,
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
    backgroundColor: colors.background,
    maxWidth: 160,
  },
  chipDark: {
    backgroundColor: darkColors.surfaceElevated,
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
  empty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
});
