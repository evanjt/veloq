/**
 * The body of a routes or sections list whose catalogue is empty, saying why.
 *
 * The engine names the reason with the routes screen read, so this only picks
 * the words, the threshold and the one action that can change the outcome. A
 * paused elevation download is resumed where it is paused, on the detection
 * settings screen.
 */

import React from 'react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  FfiCatalogueEmptyReason_Tags,
  FfiDetectionHold_Tags,
  type FfiCatalogueEmptyReason,
  type FfiDetectionHold,
} from 'veloqrs';
import { EmptyState } from '@/shared/ui';
import { tapTo } from '@/shared/app/navigation';
import { getPhaseDisplayKey } from '@/features/routes/lib/detectionProgress';

export type CatalogueKind = 'routes' | 'sections';

interface EmptyAction {
  label: string;
  onPress: () => void;
}

interface EmptyCopy {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  description: string;
  action?: EmptyAction;
}

function expandRange(t: TFunction): EmptyAction {
  return { label: t('mapScreen.expandRange') as string, onPress: () => tapTo('/sync-settings') };
}

function heldDescription(hold: FfiDetectionHold, t: TFunction): string {
  switch (hold.tag) {
    case FfiDetectionHold_Tags.ElevationPaused:
      return t('sections.detectionHeldElevationPaused') as string;
    case FfiDetectionHold_Tags.ElevationRunning:
      return t('sections.detectionPausedElevation') as string;
    case FfiDetectionHold_Tags.ElevationWaiting:
      return t('sections.detectionHeldElevationWaiting', { count: hold.inner.remaining }) as string;
    case FfiDetectionHold_Tags.Cutover:
      return t('sections.detectionPaused') as string;
    default: {
      const unhandled: never = hold;
      throw new Error(`Unhandled detection hold: ${String(unhandled)}`);
    }
  }
}

function emptyCopy(reason: FfiCatalogueEmptyReason, kind: CatalogueKind, t: TFunction): EmptyCopy {
  switch (reason.tag) {
    case FfiCatalogueEmptyReason_Tags.NoGpsActivities:
      return {
        icon: 'map-marker-off-outline',
        title: t('routes.emptyNoGpsTitle') as string,
        description: t('routes.emptyNoGps') as string,
        action: expandRange(t),
      };
    case FfiCatalogueEmptyReason_Tags.NotYetRun:
      return {
        icon: 'timer-sand',
        title: t('routes.emptyNotYetRunTitle') as string,
        description: t('routes.emptyNotYetRun', { count: reason.inner.awaiting }) as string,
      };
    case FfiCatalogueEmptyReason_Tags.Running: {
      const phaseKey = getPhaseDisplayKey(reason.inner.phase) ?? 'phaseNames.analysing';
      return {
        icon: 'progress-clock',
        title: t('routes.emptyRunningTitle') as string,
        description: t('routes.emptyRunning', {
          phase: t(phaseKey),
          percent: reason.inner.percent,
        }) as string,
      };
    }
    case FfiCatalogueEmptyReason_Tags.Held: {
      const hold = reason.inner.hold;
      return {
        icon: 'pause-circle-outline',
        title: t('routes.emptyHeldTitle') as string,
        description: heldDescription(hold, t),
        ...(hold.tag === FfiDetectionHold_Tags.ElevationPaused && {
          action: {
            label: t('common.openSettings') as string,
            onPress: () => tapTo('/detection-settings'),
          },
        }),
      };
    }
    case FfiCatalogueEmptyReason_Tags.NoneFound:
      return kind === 'routes'
        ? {
            icon: 'map-marker-path',
            title: t('routes.noRoutesYet') as string,
            description: t('routes.emptyNoRoutes', { count: reason.inner.minActivities }) as string,
            action: expandRange(t),
          }
        : {
            icon: 'road-variant',
            title: t('routes.noFrequentSections') as string,
            description: t('routes.emptyNoSections', {
              count: reason.inner.minActivities,
            }) as string,
            action: expandRange(t),
          };
    default: {
      const unhandled: never = reason;
      throw new Error(`Unhandled empty reason: ${String(unhandled)}`);
    }
  }
}

export function CatalogueEmptyState({
  reason,
  kind,
}: {
  reason: FfiCatalogueEmptyReason;
  kind: CatalogueKind;
}) {
  const { t } = useTranslation();
  const copy = emptyCopy(reason, kind, t);
  return (
    <EmptyState
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
      actionLabel={copy.action?.label}
      onAction={copy.action?.onPress}
    />
  );
}
