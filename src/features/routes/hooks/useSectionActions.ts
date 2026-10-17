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
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { goBack } from '@/shared/app/navigation';
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
import { informSectionWriteRefused } from '../lib/sectionWriteRefusal';
import { removeSectionWithUndo, restoreSection } from '../lib/sectionVisibility';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { NOTICE_LONG_MS, showNotice } from '@/shared/ui/Notice';
import { attemptEngineRead } from '@/shared/native/engineError';

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
  // The override belongs to the section whose edit set it. A merge hands this
  // hook the survivor without remounting, and an edit can end after that, so
  // an override recorded against another section is not drawn on this one.
  const [referenceOverride, setReferenceOverride] = useState<{
    sectionId: string;
    activityId: string | null;
  } | null>(null);
  const overrideReferenceId =
    referenceOverride && referenceOverride.sectionId === id ? referenceOverride.activityId : null;
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
  // Held as the section it was turned on for, so the survivor of a merge opens
  // with excluded rides hidden like any other section.
  const [showExcludedFor, setShowExcludedFor] = useState<string | undefined>(undefined);
  const showExcluded = id !== undefined && showExcludedFor === id;
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
    // A failed read keeps the set it has rather than taking the screen down;
    // the bundle's own exclusions replace it when they arrive.
    const read = attemptEngineRead(() => engine.getExcludedActivityIds(id));
    if (!read.ok) {
      log.warn('excluded ids read failed', id, read.error);
      return;
    }
    setExcludedActivityIds(new Set(read.value));
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
        inform({
          title: t('sections.renameFailedTitle'),
          message: t(renameFailureMessageKey(error)),
        });
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

    confirmAction({
      title: t('sections.deleteSection'),
      message: t('sections.deleteSectionConfirm', { name: customName || section?.name || id }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        haptics.medium();
        try {
          await removeSection(id);
          goBack();
        } catch (error) {
          if (__DEV__) console.error('Failed to delete section:', error);
          inform({ title: t('sections.deleteFailedTitle'), message: t('sections.deleteFailed') });
        }
      },
    });
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
        inform({
          title: t('sections.referenceFailedTitle'),
          message: t('sections.setReferenceError', 'Failed to set reference. Please try again.'),
        });
        return;
      }

      // The routes list reads custom sections from the query cache.
      if (isCustomId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
      }
      if (mounted.current) {
        // A reset clears the override so the section's own reference shows.
        setReferenceOverride({ sectionId: edit.sectionId, activityId: referenceId });
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
        confirmAction({
          title: t('sections.resetReference'),
          message: t('sections.resetReferenceConfirm'),
          confirmLabel: t('common.reset'),
          cancelLabel: t('common.cancel'),
          onConfirm: () => runReferenceEdit({ kind: 'resetReference', sectionId: id }, null),
        });
      } else {
        confirmAction({
          title: t('sections.setAsReference'),
          message: t('sections.setAsReferenceConfirm'),
          confirmLabel: t('sections.setAsReference'),
          cancelLabel: t('common.cancel'),
          onConfirm: () => {
            if (__DEV__) {
              log.log('[SetReference] sectionId=', id, 'activityId=', activityId);
            }
            return runReferenceEdit(
              { kind: 'setReference', sectionId: id, activityId },
              activityId
            );
          },
        });
      }
    },
    [id, t, effectiveReferenceId, section?.isUserDefined, runReferenceEdit]
  );

  // --- disable/enable ---
  // Removal keeps the section, so it runs at once and the notice offers Undo.
  const handleToggleDisable = useCallback(() => {
    if (!id || isCustomId) return;

    if (isSectionDisabled) {
      restoreSection(id, t);
    } else if (removeSectionWithUndo(id, t)) {
      goBack();
    }
  }, [id, isCustomId, isSectionDisabled, t]);

  // --- include/exclude actions ---
  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      if (!engine.includeActivityInSection(id, activityId)) {
        informSectionWriteRefused(t);
        return;
      }
      setExcludedActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
      onSectionRefresh();
    },
    [id, onSectionRefresh, t]
  );

  // Exclusion is reversible, so it runs at once and the notice offers Undo.
  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      if (!engine.excludeActivityFromSection(id, activityId)) {
        informSectionWriteRefused(t);
        return;
      }
      haptics.medium();
      setExcludedActivityIds((prev) => new Set([...prev, activityId]));
      onSectionRefresh();
      showNotice({
        message: t('sections.attemptExcluded'),
        action: { label: t('common.undo'), onPress: () => handleIncludeActivity(activityId) },
        duration: NOTICE_LONG_MS,
      });
    },
    [id, onSectionRefresh, t, handleIncludeActivity]
  );

  const handleToggleShowExcluded = useCallback(() => {
    setShowExcludedFor((shownFor) => (shownFor === id ? undefined : id));
  }, [id]);

  // --- accept/pin ---
  const handleAcceptSection = useCallback(() => {
    if (!id || isCustomId) return;
    const engine = getEngine();
    if (!engine) return;
    if (!engine.acceptSection(id)) {
      informSectionWriteRefused(t);
      return;
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
    onSectionRefresh();
  }, [id, isCustomId, queryClient, onSectionRefresh, t]);

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
    confirmAction({
      title: t('sections.unflagLift'),
      message: t('sections.unflagLiftConfirm'),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => {
        if (!engine.setSectionIsLift(id, false)) {
          log.warn('unflag refused', id);
          return;
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
        onSectionRefresh();
      },
    });
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
