/**
 * Hook for CRUD and toggle actions on a section detail screen.
 *
 * Bundles the name-edit, delete/disable, reference-select, and
 * include/exclude handlers together with their local state (editing UI,
 * override reference id, excluded activity ids, show-excluded toggle).
 *
 * The hook invalidates `queryKeys.sections.all` when appropriate and bumps
 * an external `sectionRefreshKey` (via `onSectionRefresh`) to force the
 * container to re-fetch fresh section data from the engine.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getEngine } from '@/shared/native/engine';
import { useSectionCommands } from '@/features/routes/hooks/useCustomSections';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { queryKeys } from '@/shared/query/queryKeys';
import { announceDepartedRides } from '@/features/routes/lib/departedRides';
import type { FfiDepartedRide, SectionBoundsEdit, StartVerdict } from 'veloqrs';
import { useDetectionHold } from '@/features/routes/hooks/useDetectionHold';
import type { FrequentSection } from '@/types';
import { debug } from '@/shared/debug/debug';
import * as haptics from '@/shared/ui/haptics';
import { renameFailureMessageKey } from '../lib/sectionRenameFailure';

const log = debug.create('SectionActions');

interface UseSectionActionsArgs {
  /** Section id from the URL (may be undefined on first render). */
  id: string | undefined;
  /** Whether the loaded section has the custom type. */
  isCustomId: boolean;
  /** The currently loaded section (null while loading / on not-found). */
  section: FrequentSection | null;
  /** True when `section.disabled` or `section.supersededBy` is set. */
  isSectionDisabled: boolean;
  /**
   * Force the container to re-fetch fresh section data.
   * Typically a setter that increments a refresh key counter.
   */
  onSectionRefresh: () => void;
  /** Exclusions a caller already read, so this hook skips its own FFI call. */
  preComputedExcludedActivityIds?: string[] | undefined;
  /**
   * Refresh signal owned by the container. Re-reads excluded activity ids
   * from the engine whenever this value changes (so external mutations via
   * other action sources stay in sync).
   */
  sectionRefreshKey: number;
}

export interface UseSectionActionsResult {
  // --- name state ---
  /** Committed custom name override (takes precedence over section.name). */
  customName: string | null;

  // --- reference selection state ---
  /** Effective reference activity id (override > section.representativeActivityId). */
  effectiveReferenceId: string | undefined;
  /** True while a reference edit runs; the reference action is refused until it ends. */
  isReferenceSaving: boolean;

  // --- exclusion state ---
  /** Whether excluded activities are rendered on the chart. */
  showExcluded: boolean;
  /** Set of excluded activity ids for the current section. */
  excludedActivityIds: Set<string>;

  // --- rematch state ---
  /** True while a rematch scan is in progress. */
  isRematching: boolean;
  /** True while the engine holds detection, so a rematch would be refused. */
  isRematchHeld: boolean;
  /** The engine's last refusal of a rematch, for the screen to name. */
  rescanRefusal: StartVerdict | null;

  // --- actions ---
  /** Commit the rename through the engine. A blank name clears it. */
  handleSaveName: (name: string) => void;
  /** Delete a custom section (prompts for confirmation). */
  handleDeleteSection: () => void;
  /** Prompt to set/reset an activity as the section reference. */
  handleSetAsReference: (activityId: string) => void;
  /** Toggle disabled state of an auto-detected section. */
  handleToggleDisable: () => void;
  /** Exclude an activity from this section's performance data. */
  handleExcludeActivity: (activityId: string) => void;
  /** Re-include a previously excluded activity. */
  handleIncludeActivity: (activityId: string) => void;
  /** Toggle whether excluded activities are shown on the chart. */
  handleToggleShowExcluded: () => void;
  /** Kick off a rematch scan for the current sport type. */
  handleRematchActivities: () => void;
  /** Accept (pin) an auto-detected section to protect it from re-detection. */
  handleAcceptSection: () => void;
  /** Take the detector's lift flag off this section, durably. */
  handleUnflagLift: () => void;
}

export function useSectionActions({
  id,
  isCustomId,
  section,
  isSectionDisabled,
  onSectionRefresh,
  sectionRefreshKey,
  preComputedExcludedActivityIds,
}: UseSectionActionsArgs): UseSectionActionsResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { removeSection, renameSection } = useSectionCommands();
  const { rescan, refusal: rescanRefusal, isScanning: isRematching } = useSectionRescan();
  const isRematchHeld = useDetectionHold() !== null;

  // --- name state ---
  // The text being typed belongs to the header's editor, so a keystroke does
  // not render the screen that calls this hook.
  const [customName, setCustomName] = useState<string | null>(section?.name ?? null);
  const [nameShownFor, setNameShownFor] = useState(section?.name);

  // Sync custom name when the section's name changes (e.g. after initial load
  // or after rename invalidates the query cache).
  //
  // A nameless section clears it rather than being skipped. A merge navigates
  // to the survivor with `router.replace` on the same route pattern, so this
  // hook is handed a new section without remounting, and skipping the empty
  // case left the previous section's name drawn over a survivor the detector
  // never named. An optimistic rename is not clobbered by this: it writes
  // `customName` and leaves `section.name` alone, so the dependency does not
  // change and this does not run.
  // Taking it while rendering rather than in an effect is what keeps the
  // previous section's name off the survivor: an effect adopts it one commit
  // late, and that commit is a painted frame.
  if (section?.name !== nameShownFor) {
    setNameShownFor(section?.name);
    setCustomName(section?.name ?? null);
  }

  // --- reference selection state ---
  const [overrideReferenceId, setOverrideReferenceId] = useState<string | null>(null);
  const effectiveReferenceId: string | undefined =
    overrideReferenceId ?? section?.representativeActivityId ?? undefined;
  const [isReferenceSaving, setIsReferenceSaving] = useState(false);
  const referenceEditInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // --- exclusion state ---
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedActivityIds, setExcludedActivityIds] = useState<Set<string>>(new Set());

  // Reload excluded ids when section id changes OR the container signals a
  // refresh (via `sectionRefreshKey` bump).
  useEffect(() => {
    if (!id) return;
    if (preComputedExcludedActivityIds) {
      setExcludedActivityIds(new Set(preComputedExcludedActivityIds));
      return;
    }
    const engine = getEngine();
    if (!engine) return;
    const ids = engine.getExcludedActivityIds(id);
    setExcludedActivityIds(new Set(ids));
  }, [id, sectionRefreshKey, preComputedExcludedActivityIds]);

  // --- name actions ---
  const handleSaveName = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      if (!id) {
        return;
      }

      haptics.success();

      // Update local state immediately for instant feedback
      const previousName = customName ?? section?.name ?? null;
      const nextName = trimmedName || null;
      setCustomName(nextName);

      // Fire rename in background - don't await, cache invalidation happens async
      renameSection(id, trimmedName).catch((error: unknown) => {
        setCustomName((current) => (current === nextName ? previousName : current));
        Alert.alert(t('sections.renameFailedTitle'), t(renameFailureMessageKey(error)));
        if (__DEV__) console.error('Failed to save section name:', error);
      });
    },
    [customName, id, renameSection, section?.name, t]
  );

  // --- delete ---
  const handleDeleteSection = useCallback(() => {
    if (!id || !isCustomId) {
      if (__DEV__) console.warn('[SectionDetail] Delete blocked:', { id, isCustomId });
      return;
    }

    Alert.alert(
      t('sections.deleteSection'),
      t('sections.deleteSectionConfirm', { name: customName || section?.name || id }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            haptics.medium();
            try {
              await removeSection(id);
              router.back();
            } catch (error) {
              if (__DEV__) console.error('Failed to delete section:', error);
              Alert.alert(t('common.error'), t('sections.deleteFailed'));
            }
          },
        },
      ]
    );
  }, [customName, id, isCustomId, removeSection, section?.name, t]);

  // --- reference actions ---
  // Setting or resetting the reference re-matches every ride against the new
  // line, so it runs as an engine edit off the JS thread. One runs at a time,
  // and a tap while it runs is refused rather than queued.
  const runReferenceEdit = useCallback(
    async (edit: SectionBoundsEdit, referenceId: string | null) => {
      if (referenceEditInFlight.current) return;
      referenceEditInFlight.current = true;
      setIsReferenceSaving(true);

      let departed: FfiDepartedRide[] | null = null;
      try {
        departed = (await getEngine()?.runSectionBoundsEdit(edit)) ?? null;
      } catch {
        departed = null;
      } finally {
        referenceEditInFlight.current = false;
        if (mounted.current) setIsReferenceSaving(false);
      }

      if (!departed) {
        Alert.alert(
          t('common.error'),
          t('sections.setReferenceError', 'Failed to set reference. Please try again.')
        );
        return;
      }

      // The routes list reads custom sections from the query cache.
      if (isCustomId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
      }
      if (mounted.current) {
        // A reset clears the override so the section's own reference shows.
        setOverrideReferenceId(referenceId);
        // Re-read the section for the line the edit stored.
        onSectionRefresh();
      }
      announceDepartedRides(departed, t);
    },
    [t, isCustomId, queryClient, onSectionRefresh]
  );

  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id || referenceEditInFlight.current) return;
      if (!getEngine()) return;

      // Check if this activity is already the reference. Setting a reference
      // marks the section user-defined, and the screen read that supplied
      // `section` carries the flag.
      const currentRef = effectiveReferenceId;
      const isUserDefinedRef = section?.isUserDefined === true;

      if (currentRef === activityId && isUserDefinedRef) {
        // Already the user-defined reference - offer to reset
        Alert.alert(t('sections.resetReference'), t('sections.resetReferenceConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.reset'),
            onPress: () => runReferenceEdit({ kind: 'resetReference', sectionId: id }, null),
          },
        ]);
      } else {
        Alert.alert(t('sections.setAsReference'), t('sections.setAsReferenceConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            onPress: () => {
              if (__DEV__) {
                log.log('[SetReference] sectionId=', id, 'activityId=', activityId);
              }
              return runReferenceEdit(
                { kind: 'setReference', sectionId: id, activityId },
                activityId
              );
            },
          },
        ]);
      }
    },
    [id, t, effectiveReferenceId, section?.isUserDefined, runReferenceEdit]
  );

  // --- disable/enable ---
  const handleToggleDisable = useCallback(() => {
    if (!id || isCustomId) return;

    if (isSectionDisabled) {
      // Restore
      getEngine()?.enableSection(id);
    } else {
      // Remove with confirmation, navigate back after
      Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            getEngine()?.disableSection(id);
            router.back();
          },
        },
      ]);
    }
  }, [id, isCustomId, isSectionDisabled, t]);

  // --- include/exclude actions ---
  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      engine.excludeActivityFromSection(id, activityId);
      setExcludedActivityIds((prev) => new Set([...prev, activityId]));
      onSectionRefresh();
    },
    [id, onSectionRefresh]
  );

  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      engine.includeActivityInSection(id, activityId);
      setExcludedActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
      onSectionRefresh();
    },
    [id, onSectionRefresh]
  );

  const handleToggleShowExcluded = useCallback(() => {
    setShowExcluded((v) => !v);
  }, []);

  // --- accept/pin ---
  const handleAcceptSection = useCallback(() => {
    if (!id || isCustomId) return;
    const engine = getEngine();
    if (!engine) return;
    engine.acceptSection(id);
    queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
    onSectionRefresh();
  }, [id, isCustomId, queryClient, onSectionRefresh]);

  // --- lift flag ---
  // The write is an intent, not the derived column, so it outlives the next
  // enrichment pass. A refusal leaves the badge up rather than hiding a flag
  // that is still set.
  // Asks first, the way removing a section does. Nothing in the app puts the
  // flag back, and the badge sits in a header the athlete scrolls, so a tap
  // that spends it has to be a deliberate one.
  const handleUnflagLift = useCallback(() => {
    if (!id) return;
    const engine = getEngine();
    if (!engine) return;
    Alert.alert(t('sections.unflagLift'), t('sections.unflagLiftConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          if (!engine.setSectionIsLift(id, false)) {
            log.warn('unflag refused', id);
            return;
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
          onSectionRefresh();
        },
      },
    ]);
  }, [id, t, queryClient, onSectionRefresh]);

  // --- rematch ---
  const handleRematchActivities = useCallback(() => {
    rescan();
  }, [rescan]);

  return {
    // name
    customName,
    // reference
    effectiveReferenceId,
    isReferenceSaving,
    // exclusion
    showExcluded,
    excludedActivityIds,
    // rematch
    isRematching,
    isRematchHeld,
    rescanRefusal,
    // actions
    handleSaveName,
    handleDeleteSection,
    handleSetAsReference,
    handleToggleDisable,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    handleRematchActivities,
    handleAcceptSection,
    handleUnflagLift,
  };
}
