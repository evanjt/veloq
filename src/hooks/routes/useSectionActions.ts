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
import { Alert, Keyboard, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { useCustomSections, useSectionRescan } from '@/hooks';
import { queryKeys } from '@/lib/queryKeys';
import type { FrequentSection } from '@/types';

interface UseSectionActionsArgs {
  /** Section id from the URL (may be undefined on first render). */
  id: string | undefined;
  /** Whether `id` is a custom (user-defined) section id. */
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
  /**
   * Refresh signal owned by the container. Re-reads excluded activity ids
   * from the engine whenever this value changes (so external mutations via
   * other action sources stay in sync).
   */
  sectionRefreshKey: number;
}

export interface UseSectionActionsResult {
  // --- name edit state ---
  /** Whether the inline rename input is visible. */
  isEditing: boolean;
  /** Current edit input value (not yet committed). */
  editName: string;
  /** Committed custom name override (takes precedence over section.name). */
  customName: string | null;
  /** Ref to focus the rename input after it mounts. */
  nameInputRef: React.RefObject<TextInput | null>;
  setEditName: (name: string) => void;

  // --- reference selection state ---
  /** Effective reference activity id (override > section.representativeActivityId). */
  effectiveReferenceId: string | undefined;

  // --- exclusion state ---
  /** Whether excluded activities are rendered on the chart. */
  showExcluded: boolean;
  /** Set of excluded activity ids for the current section. */
  excludedActivityIds: Set<string>;

  // --- rematch state ---
  /** True while a rematch scan is in progress. */
  isRematching: boolean;

  // --- actions ---
  /** Begin editing the section name (focuses input after ~100ms). */
  handleStartEditing: () => void;
  /** Commit the rename, validating uniqueness across all sections. */
  handleSaveName: () => void;
  /** Cancel editing without saving. */
  handleCancelEdit: () => void;
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
}

export function useSectionActions({
  id,
  isCustomId,
  section,
  isSectionDisabled,
  onSectionRefresh,
  sectionRefreshKey,
}: UseSectionActionsArgs): UseSectionActionsResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { removeSection, renameSection } = useCustomSections();
  const { rescan, isScanning: isRematching } = useSectionRescan();

  // --- name edit state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // Sync custom name when the section's name changes (e.g. after initial load
  // or after rename invalidates the query cache).
  useEffect(() => {
    if (section?.name) {
      setCustomName(section.name);
    }
  }, [section?.name]);

  // --- reference selection state ---
  const [overrideReferenceId, setOverrideReferenceId] = useState<string | null>(null);
  const effectiveReferenceId: string | undefined =
    overrideReferenceId ?? section?.representativeActivityId ?? undefined;

  // --- exclusion state ---
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedActivityIds, setExcludedActivityIds] = useState<Set<string>>(new Set());

  // Reload excluded ids when section id changes OR the container signals a
  // refresh (via `sectionRefreshKey` bump).
  useEffect(() => {
    if (!id) return;
    const engine = getRouteEngine();
    if (!engine) return;
    const ids = engine.getExcludedActivityIds(id);
    setExcludedActivityIds(new Set(ids));
  }, [id, sectionRefreshKey]);

  // --- name edit actions ---
  const handleStartEditing = useCallback(() => {
    const currentName = customName || section?.name || '';
    setEditName(currentName);
    setIsEditing(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, section?.name]);

  const handleSaveName = useCallback(() => {
    // Dismiss keyboard and close edit UI immediately for responsive feel
    Keyboard.dismiss();
    setIsEditing(false);

    const trimmedName = editName.trim();
    if (!trimmedName || !id) {
      return;
    }

    // Check uniqueness against ALL section names (custom + auto-generated)
    const allDisplayNames = getAllSectionDisplayNames();
    const isDuplicate = Object.entries(allDisplayNames).some(
      ([existingId, name]) => existingId !== id && name === trimmedName
    );

    if (isDuplicate) {
      Alert.alert(t('sections.duplicateNameTitle'), t('sections.duplicateNameMessage'));
      return;
    }

    // Update local state immediately for instant feedback
    setCustomName(trimmedName);

    // Fire rename in background - don't await, cache invalidation happens async
    renameSection(id, trimmedName).catch((error) => {
      if (__DEV__) console.error('Failed to save section name:', error);
    });
  }, [editName, id, renameSection, t]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

  // --- delete ---
  const handleDeleteSection = useCallback(() => {
    if (!id || !isCustomId) {
      if (__DEV__) console.warn('[SectionDetail] Delete blocked:', { id, isCustomId });
      return;
    }

    Alert.alert(t('sections.deleteSection'), t('sections.deleteSectionConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeSection(id);
            router.back();
          } catch (error) {
            if (__DEV__) console.error('Failed to delete section:', error);
            Alert.alert(t('common.error'), String(error));
          }
        },
      },
    ]);
  }, [id, isCustomId, removeSection, t]);

  // --- reference actions ---
  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id) return;

      const engine = getRouteEngine();
      if (!engine) return;

      // Check if this activity is already the reference
      const currentRef = effectiveReferenceId;
      const isUserDefinedRef = engine.getSectionReferenceInfo(id).isUserDefined;

      if (currentRef === activityId && isUserDefinedRef) {
        // Already the user-defined reference - offer to reset
        Alert.alert(t('sections.resetReference'), t('sections.resetReferenceConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.reset'),
            onPress: () => {
              const success = engine.resetSectionReference(id);
              if (success) {
                // Reset to automatic - clear override to use section's original
                setOverrideReferenceId(null);
                // Force section data refresh to get recalculated polyline
                onSectionRefresh();
                // Also invalidate custom sections cache for routes list
                if (isCustomId) {
                  queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
                }
              }
            },
          },
        ]);
      } else {
        // Set as new reference
        Alert.alert(t('sections.setAsReference'), t('sections.setAsReferenceConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            onPress: () => {
              if (__DEV__) {
                console.log(
                  '[SetReference] Attempting to set reference:',
                  'sectionId=',
                  id,
                  'activityId=',
                  activityId
                );
              }
              const success = engine.setSectionReference(id, activityId);
              if (__DEV__) console.log('[SetReference] Result:', success);
              if (success) {
                // Update local state immediately for responsive UI
                setOverrideReferenceId(activityId);
                // Force section data refresh to get updated polyline
                onSectionRefresh();
                // Also invalidate custom sections cache for routes list
                if (isCustomId) {
                  queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
                }
              } else {
                // Show error if operation failed
                Alert.alert(
                  t('common.error'),
                  t('sections.setReferenceError', 'Failed to set reference. Please try again.')
                );
              }
            },
          },
        ]);
      }
    },
    [id, t, effectiveReferenceId, isCustomId, queryClient, onSectionRefresh]
  );

  // --- disable/enable ---
  const handleToggleDisable = useCallback(() => {
    if (!id || isCustomId) return;

    if (isSectionDisabled) {
      // Restore
      getRouteEngine()?.enableSection(id);
    } else {
      // Remove with confirmation, navigate back after
      Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            getRouteEngine()?.disableSection(id);
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
      const engine = getRouteEngine();
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
      const engine = getRouteEngine();
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
    const engine = getRouteEngine();
    if (!engine) return;
    engine.acceptSection(id);
    queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
    onSectionRefresh();
  }, [id, isCustomId, queryClient, onSectionRefresh]);

  // --- rematch ---
  const handleRematchActivities = useCallback(() => {
    if (!section?.sportType) return;
    rescan(section.sportType);
  }, [section?.sportType, rescan]);

  return {
    // name edit
    isEditing,
    editName,
    customName,
    nameInputRef,
    setEditName,
    // reference
    effectiveReferenceId,
    // exclusion
    showExcluded,
    excludedActivityIds,
    // rematch
    isRematching,
    // actions
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
    handleDeleteSection,
    handleSetAsReference,
    handleToggleDisable,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    handleRematchActivities,
    handleAcceptSection,
  };
}
