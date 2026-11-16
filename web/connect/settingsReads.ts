// The reads the settings screen shows, and the app shell's unit choice reads
// the same two: each is a read of the query layer, so the shell and the page
// share one request.

import { useMemo } from 'react';

import { SETTING_LABELS } from './link';
import type { ReadError, ReadState } from './query';
import type { Methods } from './schema';
import { useReads } from './useRead';

/** The reads the settings screen shows, each present once it has answered. */
export type SettingsReads = {
  [
    M in
      | 'settings.get'
      | 'settings.profile'
      | 'status.backgroundJobs'
      | 'status.cache'
      | 'status.backup'
      | 'status.linkedDevices'
      | 'status.coverage'
      | 'status.sync'
  ]?: Methods[M]['result'];
};

/** The asks that open the settings screen: the settings, the profile and each status. */
export function settingsAsks(): { method: keyof SettingsReads; args: object }[] {
  return [
    { method: 'settings.get', args: { keys: SETTING_LABELS.map(([key]) => key) } },
    { method: 'settings.profile', args: {} },
    { method: 'status.backgroundJobs', args: {} },
    { method: 'status.cache', args: {} },
    { method: 'status.backup', args: {} },
    { method: 'status.linkedDevices', args: {} },
    { method: 'status.coverage', args: {} },
    { method: 'status.sync', args: {} },
  ];
}

export type SettingsRead = {
  reads: Readonly<SettingsReads>;
  /** Why a read has no answer, by method: a phone one version behind lacks some. */
  errors: Readonly<Partial<Record<keyof SettingsReads, ReadError>>>;
  loading: boolean;
};

const ASKS = settingsAsks();

export function useSettingsReads(): SettingsRead {
  const states = useReads(ASKS) as readonly ReadState<unknown>[];
  return useMemo(() => {
    const reads: Record<string, unknown> = {};
    const errors: Partial<Record<keyof SettingsReads, ReadError>> = {};
    ASKS.forEach((ask, at) => {
      const state = states[at];
      if (state?.data !== undefined) reads[ask.method] = state.data;
      else if (state?.error) errors[ask.method] = state.error;
    });
    return {
      reads: reads as SettingsReads,
      errors,
      loading: states.some((state) => state.loading),
    };
  }, [states]);
}
